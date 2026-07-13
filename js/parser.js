/**
 * CondoConvert — PDF Parser Strategy Manager
 * Extracts inadimplência data from PDF files using pdf.js
 */

// Set pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Month abbreviation to number mapping (Portuguese)
const MONTHS_PT = {
    'jan': 1, 'fev': 2, 'mar': 3, 'abr': 4,
    'mai': 5, 'jun': 6, 'jul': 7, 'ago': 8,
    'set': 9, 'out': 10, 'nov': 11, 'dez': 12
};

/**
 * Parse a Brazilian currency value string to a number.
 * Handles: "1.098,46", "997,00", "1098,46", "997,000"
 */
function parseMoneyValue(str) {
    if (!str) return 0;
    // Remove dots (thousand separators), replace comma with period
    const cleaned = str.replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
}

/**
 * Parse competência string to { month, year }
 * "fev/26" → { month: 2, year: 2026 }
 */
function parseCompetencia(comp) {
    const parts = comp.toLowerCase().split('/');
    const month = MONTHS_PT[parts[0]];
    const year = 2000 + parseInt(parts[1]);
    return { month, year };
}

/**
 * Extract raw text items from a PDF file.
 */
async function extractAllItems(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const allItems = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });

        let valorHeaderX = null;

        for (const item of textContent.items) {
            if (!item.str.trim()) continue;
            const x = item.transform[4];
            const y = viewport.height - item.transform[5];

            if (item.str.trim().toUpperCase() === 'VALOR') {
                valorHeaderX = x;
            }

            allItems.push({
                text: item.str,
                x: Math.round(x),
                y: Math.round(y * 10) / 10,
                page: pageNum
            });
        }

        if (valorHeaderX !== null) {
            allItems._valorX = valorHeaderX;
        }
    }
    return allItems;
}

/**
 * Group text items into lines, optionally filtering out the VALOR column.
 */
function groupItemsIntoLines(allItems, filterValorColumn) {
    const valorX = allItems._valorX || 9999;
    const totalColumnThreshold = valorX - 15;

    const filteredItems = allItems.filter(item => {
        if (!filterValorColumn) return true; // Keep all items for new formats
        if (item.y < 50) return true;
        return item.x < totalColumnThreshold;
    });

    filteredItems.sort((a, b) => {
        if (a.page !== b.page) return a.page - b.page;
        if (Math.abs(a.y - b.y) > 3) return a.y - b.y;
        return a.x - b.x;
    });

    const lines = [];
    let currentLine = [];
    let currentY = null;

    for (const item of filteredItems) {
        if (currentY === null || Math.abs(item.y - currentY) <= 3) {
            currentLine.push(item);
            if (currentY === null) currentY = item.y;
        } else {
            if (currentLine.length > 0) {
                currentLine.sort((a, b) => a.x - b.x);
                const lineText = currentLine.map(i => i.text).join(' ').trim();
                if (lineText) lines.push(lineText);
            }
            currentLine = [item];
            currentY = item.y;
        }
    }

    if (currentLine.length > 0) {
        currentLine.sort((a, b) => a.x - b.x);
        const lineText = currentLine.map(i => i.text).join(' ').trim();
        if (lineText) lines.push(lineText);
    }

    return lines;
}

/**
 * Remove consecutive duplicate entries (from page breaks).
 */
function deduplicateEntries(entries) {
    return entries.filter((item, index) => {
        if (index === 0) return true;
        const prev = entries[index - 1];
        return !(
            item.unit === prev.unit &&
            item.competencia === prev.competencia &&
            item.description === prev.description &&
            Math.abs(item.value - prev.value) < 0.01
        );
    });
}

// ============================================================================
// STRATEGY: FORMATO VARANDAS
// ============================================================================

const UNIT_COMP_REGEX = /^(\d{1,4})\s+((?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/\d{2})\s*(.*)/i;
const COMP_LINE_REGEX = /^((?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/\d{2})\s*(.*)/i;
const DESC_VALUE_REGEX = /^(.+?)\s*:\s*R\$\s*([\d.,]+)/;
const ACORDO_REGEX = /^(Acordo\s+.+?)\s+R\$\s*([\d.,]+)/i;

function tryParseDescriptionVarandas(text) {
    if (!text || !text.trim()) return null;
    text = text.trim();

    let match = text.match(DESC_VALUE_REGEX);
    if (match) {
        const desc = match[1].trim();
        if (/^(UNIDADE|COMPETENCIA|DESCRI|VALOR|INADIMPL)/i.test(desc)) return null;
        return {
            description: desc.replace(/\s+/g, ' '),
            value: parseMoneyValue(match[2])
        };
    }

    match = text.match(ACORDO_REGEX);
    if (match) {
        return {
            description: match[1].trim().replace(/\s+/g, ' '),
            value: parseMoneyValue(match[2])
        };
    }
    return null;
}

function isStartOfNewBlockVarandas(desc, results) {
    if (results.length === 0) return false;
    const isCota = /^cota/i.test(desc.description);
    if (!isCota) return false;
    const lastResult = results[results.length - 1];
    const lastDesc = lastResult.description.toLowerCase();
    return lastDesc.startsWith('gás') || lastDesc.startsWith('gas') || lastDesc.startsWith('g\u00e1s') || lastDesc.startsWith('acordo');
}

function parseLinesVarandas(lines) {
    const results = [];
    let currentUnit = null;
    let currentComp = null;
    let pendingDescs = []; 
    const unitsSet = new Set();
    const blocksSet = new Set();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (/^INADIMPL/i.test(line) || /^UNIDADE\s/i.test(line) || /^DESCRI[CÇ]/i.test(line)) continue;

        const unitCompMatch = line.match(UNIT_COMP_REGEX);
        if (unitCompMatch) {
            currentUnit = unitCompMatch[1];
            currentComp = unitCompMatch[2];
            unitsSet.add(currentUnit);

            for (const desc of pendingDescs) {
                results.push({ unit: currentUnit, competencia: currentComp, description: desc.description, value: desc.value });
            }
            pendingDescs = [];

            const rest = unitCompMatch[3].trim();
            if (rest) {
                const desc = tryParseDescriptionVarandas(rest);
                if (desc) results.push({ unit: currentUnit, competencia: currentComp, description: desc.description, value: desc.value });
            }
            continue;
        }

        const compMatch = line.match(COMP_LINE_REGEX);
        if (compMatch) {
            currentComp = compMatch[1];

            for (const desc of pendingDescs) {
                results.push({ unit: currentUnit, competencia: currentComp, description: desc.description, value: desc.value });
            }
            pendingDescs = [];

            const rest = compMatch[2].trim();
            if (rest) {
                const desc = tryParseDescriptionVarandas(rest);
                if (desc) results.push({ unit: currentUnit, competencia: currentComp, description: desc.description, value: desc.value });
            }
            continue;
        }

        const desc = tryParseDescriptionVarandas(line);
        if (desc) {
            const isNewBlock = isStartOfNewBlockVarandas(desc, results);

            if (!currentUnit || !currentComp || isNewBlock) {
                pendingDescs.push(desc);
            } else {
                results.push({ unit: currentUnit, competencia: currentComp, description: desc.description, value: desc.value });
            }
            continue;
        }

        const blockMatch = line.match(/^(?:BLOCO|BL\.?)\s+([A-Z])/i);
        if (blockMatch) {
            blocksSet.add(blockMatch[1].toUpperCase());
            continue;
        }
    }

    for (const desc of pendingDescs) {
        if (currentUnit && currentComp) {
            results.push({ unit: currentUnit, competencia: currentComp, description: desc.description, value: desc.value });
        }
    }

    return {
        entries: deduplicateEntries(results),
        units: Array.from(unitsSet),
        blocks: Array.from(blocksSet).sort()
    };
}


// ============================================================================
// STRATEGY: RELAÇÃO ANALÍTICA DE PENDENTES
// ============================================================================

const REL_BLOCK_UNIT_REGEX = /^Bloco\s*:\s*(.*?)\s+Unidade\s*:\s*(\S+)/i;
const REL_PRINCIPAL_REGEX = /^(\d+)\s+(\S+)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(\d+)\s+(.*?)\s+([\d.,]+)(?:\s+[\d.,]+)*$/;
const REL_ITEMS_REGEX = /^(\d+)\s+(.*?)\s+([\d.,]+)(?:\s+[\d.,]+)*$/;

function parseLinesRelPendentes(lines) {
    const results = [];
    let currentUnit = null;
    let currentComp = null;
    const unitsSet = new Set();
    const blocksSet = new Set();

    const monthNames = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    for (const line of lines) {
        const text = line.trim();
        if (!text) continue;

        // Bloco e Unidade
        const blockMatch = text.match(REL_BLOCK_UNIT_REGEX);
        if (blockMatch) {
            const block = blockMatch[1].trim().toUpperCase();
            const unit = blockMatch[2].trim();
            blocksSet.add(block);
            unitsSet.add(unit);
            currentUnit = unit;
            continue;
        }

        if (!currentUnit) continue; // Skip lines until we find a unit

        // Linha Principal (Recibo)
        const mainMatch = text.match(REL_PRINCIPAL_REGEX);
        if (mainMatch) {
            const vencimento = mainMatch[3]; // DD/MM/YYYY
            const description = mainMatch[6].trim();
            const valueStr = mainMatch[7];

            // Transformar "10/11/2025" em "nov/25"
            const parts = vencimento.split('/');
            const monthIndex = parseInt(parts[1], 10) - 1;
            const yearStr = parts[2].substring(2);
            currentComp = `${monthNames[monthIndex]}/${yearStr}`;

            results.push({
                unit: currentUnit,
                competencia: currentComp,
                description: description,
                value: parseMoneyValue(valueStr)
            });
            continue;
        }

        // Linha Secundária (Itens)
        if (currentComp) {
            const itemMatch = text.match(REL_ITEMS_REGEX);
            if (itemMatch) {
                const description = itemMatch[2].trim();
                const valueStr = itemMatch[3];
                results.push({
                    unit: currentUnit,
                    competencia: currentComp,
                    description: description,
                    value: parseMoneyValue(valueStr)
                });
            }
        }
    }

    return {
        entries: deduplicateEntries(results),
        units: Array.from(unitsSet),
        blocks: Array.from(blocksSet).sort()
    };
}

// ============================================================================
// STRATEGY: INADIMPLÊNCIA PARCIAL (Webmínio Portal)
// ============================================================================

// Month full name to abbreviation mapping
const MONTH_FULL_TO_ABBR = {
    'janeiro': 'jan', 'fevereiro': 'fev', 'março': 'mar', 'marco': 'mar',
    'abril': 'abr', 'maio': 'mai', 'junho': 'jun',
    'julho': 'jul', 'agosto': 'ago', 'setembro': 'set',
    'outubro': 'out', 'novembro': 'nov', 'dezembro': 'dez'
};

/**
 * Extract competência from description text like "COND. FEVEREIRO/2026" or "COND. ABRIL/2026"
 * Returns { comp: "fev/26", cleanDesc: "COND." } or null
 */
function extractCompFromDesc(text) {
    // Pattern: MONTH_NAME/YEAR (e.g. FEVEREIRO/2026, ABRIL/2026)
    const match = text.match(/(\w+)\/(\d{4})/i);
    if (match) {
        const monthName = match[1].toLowerCase();
        const abbr = MONTH_FULL_TO_ABBR[monthName];
        if (abbr) {
            const yearShort = match[2].substring(2);
            const comp = `${abbr}/${yearShort}`;
            const cleanDesc = text.replace(match[0], '').trim();
            return { comp, cleanDesc };
        }
    }
    return null;
}

/**
 * Parse lines from the "Inadimplência Parcial" format (Webmínio portal).
 *
 * Key insight: descriptions WRAP AROUND receipt lines.
 *   "FUNDO DE"          ← prefix (before receipt)
 *   61926023 4073 R$…   ← receipt line
 *   "RESERVA"           ← suffix (after receipt, continuation)
 * Full description = "FUNDO DE RESERVA"
 *
 * Rule: after each receipt, consume AT MOST ONE post-line:
 *   - If it's a MONTH line (FEVEREIRO/2026) → skip it (comp already from date)
 *   - If it's plain text → append as description continuation
 *   - Anything else → stop (it's structural)
 * Then subsequent text lines become pendingDesc for the NEXT receipt.
 */
function parseLinesInadimplenciaParcial(lines) {
    const results = [];
    let currentUnit = null;
    let currentBlock = '0';
    let currentComp = null;
    const unitsSet = new Set();
    const blocksSet = new Set();

    const UNIT_HEADER = /^Bloco\s*:\s*(\S+)\s+Unidade\s*:\s*(\d+)\s+(.*)/i;
    const RECEIPT_MAIN = /^(?:J\s+)?(\d+)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(\d+)\s+(.*?)\s*R\$\s*([\d.,]+)/;
    const RECEIPT_SECONDARY = /^(?:J\s+)?(\d+)\s+(\d+)\s+(.*?)\s*R\$\s*([\d.,]+)/;
    const MONTH_PATTERN = /(JANEIRO|FEVEREIRO|MAR[CÇ]O|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\/(\d{4})/i;
    const monthNames = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    let pendingDesc = '';

    // Helper: is this line noise/header that should be skipped entirely?
    function isNoiseLine(text) {
        return /^No que podemos/i.test(text)
            || /^Daniel Meneghin/i.test(text)
            || /^Informe a Unidade/i.test(text)
            || /^Exportar Excel/i.test(text)
            || /^Per[ií]odo de/i.test(text)
            || /^Condom[ií]nio:/i.test(text)
            || /^Recibo\s+Vencimento/i.test(text)
            || /^Original\s+Principal/i.test(text)
            || /^Valor\s+Valor/i.test(text)
            || /^Total do Recibo/i.test(text)
            || /^Total Geral da Unidade/i.test(text)
            || /^Quantidade de unidade/i.test(text)
            || /^Importante\s*:/i.test(text)
            || /^Webm[ií]nio/i.test(text)
            || /^Atendimento$/i.test(text)
            || /^R\$\s+[\d.,]+\s+[\d.,]+/i.test(text)
            || /^\d+\s*:$/i.test(text);
    }

    // Helper: is this a structural line (receipt, unit header, total)?
    function isStructuralLine(text) {
        return RECEIPT_MAIN.test(text)
            || RECEIPT_SECONDARY.test(text)
            || UNIT_HEADER.test(text)
            || /^Total/i.test(text)
            || /^Bloco\s*:/i.test(text)
            || isNoiseLine(text);
    }

    // Helper: clean garbage from page-break text corruption
    function cleanDescText(text) {
        return text.replace(/A\d*t[,.]?\d*e\d*n\d*d\d*i\d*m\d*e\d*n\d*t\d*o\d*/gi, '').trim();
    }

    // After pushing a receipt result, look ahead and consume ONE continuation line
    function consumeContinuation(startIdx) {
        for (let j = startIdx; j < lines.length; j++) {
            const nextLine = lines[j].trim();
            if (!nextLine) continue;
            if (isNoiseLine(nextLine)) continue;

            // Month line → skip it, counts as the "one post-line" consumed
            if (MONTH_PATTERN.test(nextLine)) {
                return j; // consumed the month, stop
            }

            // Structural line → don't consume, stop
            if (isStructuralLine(nextLine)) {
                return j - 1; // back up, main loop will process it
            }

            // Plain text → it's continuation, append to last result
            const cleaned = cleanDescText(nextLine);
            if (cleaned && results.length > 0) {
                const last = results[results.length - 1];
                last.description = (last.description + ' ' + cleaned).replace(/\s+/g, ' ').trim();
            }
            return j; // consumed one text line, stop
        }
        return startIdx - 1;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (isNoiseLine(line)) continue;

        // ── Unit header ──
        const unitMatch = line.match(UNIT_HEADER);
        if (unitMatch) {
            currentBlock = unitMatch[1].trim();
            currentUnit = unitMatch[2].trim();
            unitsSet.add(currentUnit);
            blocksSet.add(currentBlock);
            currentComp = null;
            pendingDesc = '';
            continue;
        }

        if (!currentUnit) continue;

        // ── Main receipt line (has date) ──
        const mainMatch = line.match(RECEIPT_MAIN);
        if (mainMatch) {
            const vencimento = mainMatch[2];
            const inlineDesc = mainMatch[5].trim();
            const value = parseMoneyValue(mainMatch[6]);

            // Comp from vencimento date
            const parts = vencimento.split('/');
            const monthIndex = parseInt(parts[1], 10) - 1;
            currentComp = `${monthNames[monthIndex]}/${parts[2].substring(2)}`;

            // Build description: pendingDesc (prefix) + inline
            let description = pendingDesc;
            if (inlineDesc) {
                const compExtract = extractCompFromDesc(inlineDesc);
                if (compExtract) {
                    if (compExtract.cleanDesc) {
                        description = description ? `${description} ${compExtract.cleanDesc}` : compExtract.cleanDesc;
                    }
                } else {
                    description = description ? `${description} ${inlineDesc}` : inlineDesc;
                }
            }

            pendingDesc = '';
            if (description && value > 0) {
                results.push({
                    unit: currentUnit,
                    block: currentBlock,
                    competencia: currentComp,
                    description: description.replace(/\s+/g, ' ').trim(),
                    value: value
                });
                
                // Only consume a continuation line if there was NO inline description
                if (!inlineDesc) {
                    i = consumeContinuation(i + 1);
                }
            }
            continue;
        }

        // ── Secondary receipt line (no date, same receipt group) ──
        const secMatch = line.match(RECEIPT_SECONDARY);
        if (secMatch && currentComp) {
            const inlineDesc = secMatch[3].trim();
            const value = parseMoneyValue(secMatch[4]);

            // Build description: pendingDesc (prefix) + inline
            let description = pendingDesc;
            if (inlineDesc) {
                description = description ? `${description} ${inlineDesc}` : inlineDesc;
            }

            pendingDesc = '';
            if (description && value > 0) {
                results.push({
                    unit: currentUnit,
                    block: currentBlock,
                    competencia: currentComp,
                    description: description.replace(/\s+/g, ' ').trim(),
                    value: value
                });
                
                // Only consume a continuation line if there was NO inline description
                if (!inlineDesc) {
                    i = consumeContinuation(i + 1);
                }
            }
            continue;
        }

        // ── Month line (standalone, e.g. "FEVEREIRO/2026") ──
        const monthMatch = line.match(MONTH_PATTERN);
        if (monthMatch) {
            const mName = monthMatch[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const abbr = MONTH_FULL_TO_ABBR[mName] || MONTH_FULL_TO_ABBR[monthMatch[1].toLowerCase()];
            if (abbr) {
                currentComp = `${abbr}/${monthMatch[2].substring(2)}`;
            }
            const clean = line.replace(MONTH_PATTERN, '').trim();
            if (clean) {
                pendingDesc = pendingDesc ? `${pendingDesc} ${clean}` : clean;
            }
            continue;
        }

        // ── Description fragment → accumulate as prefix for the next receipt ──
        const cleanLine = cleanDescText(line);
        if (cleanLine && !/^\d+[.,]\d+$/.test(cleanLine)) {
            pendingDesc = pendingDesc ? `${pendingDesc} ${cleanLine}` : cleanLine;
        }
    }

    return {
        entries: deduplicateEntries(results),
        units: Array.from(unitsSet),
        blocks: Array.from(blocksSet).sort()
    };
}


// ============================================================================
// PDF DETECTOR AND ROUTER
// ============================================================================

/**
 * Detects the layout format of the PDF based on textual clues in the first few lines.
 * Returns the correct parsing strategy function.
 */
function detectLayoutAndParse(allItems) {
    const rawLines = groupItemsIntoLines(allItems, false);
    const sampleText = rawLines.slice(0, 20).join(' ').toLowerCase();

    if (sampleText.includes('relação analítica de pendentes')) {
        console.log("Detected PDF Layout: REL_PENDENTES");
        return parseLinesRelPendentes(rawLines);
    }

    // Detect "Inadimplência Parcial" format (Webmínio portal)
    if (sampleText.includes('recibo') && sampleText.includes('vencimento') &&
        sampleText.includes('emissão') && sampleText.includes('conta')) {
        console.log("Detected PDF Layout: INADIMPLENCIA_PARCIAL");
        return parseLinesInadimplenciaParcial(rawLines);
    }

    if (sampleText.includes('unidade') && sampleText.includes('compet') && sampleText.includes('descri')) {
        console.log("Detected PDF Layout: VARANDAS");
        const filteredLines = groupItemsIntoLines(allItems, true);
        return parseLinesVarandas(filteredLines);
    }

    console.warn("Unrecognized PDF layout. Attempting fallback parser (Varandas).");
    const result = parseLinesVarandas(groupItemsIntoLines(allItems, true));
    
    if (result.entries.length === 0) {
        throw new Error("UNRECOGNIZED_FORMAT");
    }

    return result;
}

/**
 * Heurística para tentar extrair o valor total impresso no PDF
 */
function extractPdfTotal(lines) {
    const bottomLines = lines.slice(-40).reverse();
    for (const line of bottomLines) {
        if (/total|geral|soma|receita/i.test(line)) {
            const matches = line.match(/[\d.,]{4,}/g);
            if (matches) {
                return parseMoneyValue(matches[matches.length - 1]);
            }
        }
    }
    return 0;
}

/**
 * Main entry point: Parse a PDF file and return structured data.
 * @param {File} file - The PDF file to parse
 * @returns {Promise<{ entries: Array, units: string[], blocks: string[], pdfTotal: number }>}
 */
async function parsePDF(file) {
    const allItems = await extractAllItems(file);
    const result = detectLayoutAndParse(allItems);
    result.pdfTotal = extractPdfTotal(groupItemsIntoLines(allItems, false));
    return result;
}

/**
 * Format a unit number with the specified number of digits.
 * @param {string} unit - The unit number (e.g., "11")
 * @param {number} digits - The desired number of digits (e.g., 6)
 * @returns {string} Formatted unit (e.g., "000011")
 */
function formatUnit(unit, digits) {
    return unit.padStart(digits, '0');
}

/**
 * Format a competência date string according to the specified format.
 * @param {string} comp - Competência string (e.g., "fev/26")
 * @param {string} format - Date format (e.g., "DD/MM/YYYY")
 * @returns {string} Formatted date string
 */
function formatDate(comp, format) {
    const { month, year } = parseCompetencia(comp);
    const day = 1;

    const pad2 = (n) => n.toString().padStart(2, '0');

    switch (format) {
        case 'DD/MM/YYYY':
            return `${pad2(day)}/${pad2(month)}/${year}`;
        case 'D/M/YYYY':
            return `${day}/${month}/${year}`;
        case 'MM/DD/YYYY':
            return `${pad2(month)}/${pad2(day)}/${year}`;
        case 'YYYY-MM-DD':
            return `${year}-${pad2(month)}-${pad2(day)}`;
        case 'DD/MM/YY':
            return `${pad2(day)}/${pad2(month)}/${year.toString().slice(-2)}`;
        default:
            return `${pad2(day)}/${pad2(month)}/${year}`;
    }
}
