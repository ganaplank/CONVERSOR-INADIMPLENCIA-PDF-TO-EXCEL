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
 * Structure:
 *   - Unit header: "Bloco: X Unidade: NNNNNN NOME COMPLETO"
 *   - Receipt main line: "[J ]RECIBO_NUM DD/MM/YYYY EMISSAO CONTA R$ VALUE ..."
 *   - Receipt secondary line: "[J ]RECIBO_NUM CONTA R$ VALUE ..."  (description on prev/next line)
 *   - Description lines: "COND.", "FEVEREIRO/2026", "FUNDO DE", "RESERVA", etc.
 *   - Totals to skip: "Total do Recibo:", "Total Geral da Unidade:"
 */
function parseLinesInadimplenciaParcial(lines) {
    const results = [];
    let currentUnit = null;
    let currentBlock = '0';
    let currentComp = null;
    const unitsSet = new Set();
    const blocksSet = new Set();

    // Regex for unit header: Bloco: 0 Unidade: 000032 NOME
    const UNIT_HEADER = /^Bloco\s*:\s*(\S+)\s+Unidade\s*:\s*(\d+)\s+(.*)/i;

    // Regex for receipt line with date (main line):
    // [J ]61926023 08/02/2026 408996 2542 [DESCRIPTION] R$ 550,22 550,22 ...
    const RECEIPT_MAIN = /^(?:J\s+)?(\d+)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(\d+)\s+(.*?)\s*R\$\s*([\d.,]+)/;

    // Regex for secondary receipt line (no date):
    // [J ]61926023 4073 R$ 27,51 27,51 ...
    const RECEIPT_SECONDARY = /^(?:J\s+)?(\d+)\s+(\d+)\s+(.*?)\s*R\$\s*([\d.,]+)/;

    // Month names in descriptions for competência extraction
    const MONTH_PATTERN = /(JANEIRO|FEVEREIRO|MAR[CÇ]O|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\/(\d{4})/i;

    const monthNames = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    // Buffer for accumulating multi-line descriptions
    let pendingDesc = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Skip noise lines
        if (/^No que podemos/i.test(line)) continue;
        if (/^Daniel Meneghin/i.test(line)) continue;
        if (/^Informe a Unidade/i.test(line)) continue;
        if (/^Exportar Excel/i.test(line)) continue;
        if (/^Per[ií]odo de/i.test(line)) continue;
        if (/^Condom[ií]nio:/i.test(line)) continue;
        if (/^Recibo\s+Vencimento/i.test(line)) continue;
        if (/^Original\s+Principal/i.test(line)) continue;
        if (/^Valor\s+Valor/i.test(line)) continue;
        if (/^Total do Recibo/i.test(line)) continue;
        if (/^Total Geral da Unidade/i.test(line)) continue;
        if (/^Quantidade de unidade/i.test(line)) continue;
        if (/^Importante\s*:/i.test(line)) continue;
        if (/^Webm[ií]nio/i.test(line)) continue;
        if (/^Atendimento$/i.test(line)) continue;
        if (/^R\$\s+[\d.,]+\s+[\d.,]+/i.test(line)) continue; // Total lines starting with R$

        // Unit header
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

        // Main receipt line (has date)
        const mainMatch = line.match(RECEIPT_MAIN);
        if (mainMatch) {
            const vencimento = mainMatch[2]; // DD/MM/YYYY
            const inlineDesc = mainMatch[5].trim();
            const value = parseMoneyValue(mainMatch[6]);

            // Extract competência from vencimento date
            const parts = vencimento.split('/');
            const monthIndex = parseInt(parts[1], 10) - 1;
            const yearStr = parts[2].substring(2);
            currentComp = `${monthNames[monthIndex]}/${yearStr}`;

            // Check if description contains month (e.g. "COND. ABRIL/2026" inline)
            let description = '';
            if (inlineDesc) {
                const compExtract = extractCompFromDesc(inlineDesc);
                if (compExtract && compExtract.cleanDesc) {
                    description = compExtract.cleanDesc;
                } else if (inlineDesc && !MONTH_PATTERN.test(inlineDesc)) {
                    description = inlineDesc;
                }
            }

            // If we had a pending description from previous line, use it
            if (!description && pendingDesc) {
                description = pendingDesc;
            }

            // Description might be on the NEXT line
            if (!description) {
                // Look ahead for description
                let nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
                // Only use it if it's not another receipt/unit/total line
                if (nextLine && !RECEIPT_MAIN.test(nextLine) && !RECEIPT_SECONDARY.test(nextLine) &&
                    !UNIT_HEADER.test(nextLine) && !/^Total/i.test(nextLine) &&
                    !/^Bloco\s*:/i.test(nextLine) && !/^Atendimento$/i.test(nextLine)) {
                    // Check for month pattern in next line
                    const monthMatch = nextLine.match(MONTH_PATTERN);
                    if (monthMatch) {
                        // This is just the month, desc was on the previous pending
                        nextLine = nextLine.replace(MONTH_PATTERN, '').trim();
                    }
                    if (nextLine) {
                        description = nextLine;
                        i++; // consume the next line
                    }
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
            }
            continue;
        }

        // Secondary receipt line (same receipt number, different account)
        const secMatch = line.match(RECEIPT_SECONDARY);
        if (secMatch && currentComp) {
            const inlineDesc = secMatch[3].trim();
            const value = parseMoneyValue(secMatch[4]);

            let description = '';
            if (inlineDesc) {
                description = inlineDesc;
            }

            // If no inline description, use pending from previous line
            if (!description && pendingDesc) {
                description = pendingDesc;
            }

            // If still no description, look ahead
            if (!description) {
                let nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
                if (nextLine && !RECEIPT_MAIN.test(nextLine) && !RECEIPT_SECONDARY.test(nextLine) &&
                    !UNIT_HEADER.test(nextLine) && !/^Total/i.test(nextLine) &&
                    !/^Bloco\s*:/i.test(nextLine) && !/^Atendimento$/i.test(nextLine) &&
                    !/^R\$/.test(nextLine)) {
                    description = nextLine;
                    i++;
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
            }
            continue;
        }

        // It's a description line (not a receipt, not a header, not a total)
        // Examples: "COND.", "FEVEREIRO/2026", "FUNDO DE", "RESERVA", "CONSUMO", "ÁGUA"
        // Check if it's a month/year line
        const monthMatch = line.match(MONTH_PATTERN);
        if (monthMatch) {
            // Update competência from the month in description
            const mName = monthMatch[1].toLowerCase().replace('ç', 'c');
            const abbr = MONTH_FULL_TO_ABBR[mName] || MONTH_FULL_TO_ABBR[mName.replace('c', 'ç')];
            if (abbr) {
                currentComp = `${abbr}/${monthMatch[2].substring(2)}`;
            }
            // Clean whatever description was around the month
            const clean = line.replace(MONTH_PATTERN, '').trim();
            if (clean) {
                pendingDesc = pendingDesc ? `${pendingDesc} ${clean}` : clean;
            }
            continue;
        }

        // Regular description fragment: accumulate it
        // Remove trailing garbage like "A0t,8e4ndime2n9,t2o7" from page breaks
        const cleanLine = line.replace(/A\d*t[,.]?\d*e\d*n\d*d\d*i\d*m\d*e\d*n\d*t\d*o\d*/gi, '').trim();
        if (cleanLine && !/^\d+[.,]\d+$/.test(cleanLine)) {
            // Merge multi-line descriptions: "FUNDO DE" + "RESERVA" = "FUNDO DE RESERVA"
            // "RECOMPOSIÇÃO" + "DE CAIXA 3/6" = "RECOMPOSIÇÃO DE CAIXA"
            if (pendingDesc) {
                pendingDesc = `${pendingDesc} ${cleanLine}`;
            } else {
                pendingDesc = cleanLine;
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
