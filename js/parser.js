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
 * Extract text items from a PDF file and group them into lines by Y coordinate proximity.
 * @param {File} file - The PDF file
 * @returns {Promise<string[]>} Array of text lines
 */
async function extractTextLines(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const allItems = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });

        // Find the X position of the "VALOR" header to identify the total column (Specific to Varandas, but safe overall)
        let valorHeaderX = null;

        for (const item of textContent.items) {
            if (!item.str.trim()) continue;
            const x = item.transform[4];
            const y = viewport.height - item.transform[5]; // Convert to top-down Y

            if (item.str.trim().toUpperCase() === 'VALOR') {
                valorHeaderX = x;
            }

            allItems.push({
                text: item.str,
                x: Math.round(x),
                y: Math.round(y * 10) / 10, // round to 1 decimal for grouping
                page: pageNum
            });
        }

        // Store the VALOR X position for this page (reuse from page 1 if not found)
        if (valorHeaderX !== null) {
            allItems._valorX = valorHeaderX;
        }
    }

    // Get the total column X threshold
    const valorX = allItems._valorX || 9999;
    const totalColumnThreshold = valorX - 15; // Items at or past this X are totals

    // Filter out items that are in the total column (VALOR/total values on the right)
    const filteredItems = allItems.filter(item => {
        // Keep header items
        if (item.y < 50) return true;
        // Filter out items in the total column
        return item.x < totalColumnThreshold;
    });

    // Sort by page, then Y (top to bottom), then X (left to right)
    filteredItems.sort((a, b) => {
        if (a.page !== b.page) return a.page - b.page;
        if (Math.abs(a.y - b.y) > 3) return a.y - b.y; // different lines
        return a.x - b.x; // same line, sort by X
    });

    // Group into lines by Y proximity
    const lines = [];
    let currentLine = [];
    let currentY = null;

    for (const item of filteredItems) {
        if (currentY === null || Math.abs(item.y - currentY) <= 3) {
            currentLine.push(item);
            if (currentY === null) currentY = item.y;
        } else {
            // New line
            if (currentLine.length > 0) {
                currentLine.sort((a, b) => a.x - b.x);
                const lineText = currentLine.map(i => i.text).join(' ').trim();
                if (lineText) lines.push(lineText);
            }
            currentLine = [item];
            currentY = item.y;
        }
    }

    // Flush last line
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
// PDF DETECTOR AND ROUTER
// ============================================================================

/**
 * Detects the layout format of the PDF based on textual clues in the first few lines.
 * Returns the correct parsing strategy function.
 */
function detectLayoutAndParse(lines) {
    // Combine the first 20 lines to search for clues
    const sampleText = lines.slice(0, 20).join(' ').toLowerCase();

    // Heuristics for Varandas:
    // Usually has "UNIDADE COMPETENCIA" header, and descriptions separated by " : R$"
    if (sampleText.includes('unidade') && sampleText.includes('compet') && sampleText.includes('descri')) {
        console.log("Detected PDF Layout: VARANDAS");
        return parseLinesVarandas(lines);
    }

    // Future formats can be added here:
    // if (sampleText.includes('boleto bancario predio b')) { ... }

    // Fallback if we don't recognize the format: 
    // In the future we can make this throw an Error. For now, try Varandas.
    console.warn("Unrecognized PDF layout. Attempting fallback parser (Varandas).");
    const result = parseLinesVarandas(lines);
    
    if (result.entries.length === 0) {
        throw new Error("UNRECOGNIZED_FORMAT");
    }

    return result;
}

/**
 * Main entry point: Parse a PDF file and return structured data.
 * @param {File} file - The PDF file to parse
 * @returns {Promise<{ entries: Array, units: string[], blocks: string[] }>}
 */
async function parsePDF(file) {
    const lines = await extractTextLines(file);
    return detectLayoutAndParse(lines);
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
