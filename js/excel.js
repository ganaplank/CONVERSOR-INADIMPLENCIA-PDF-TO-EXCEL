/**
 * CondoConvert — Excel Generator
 * Generates .xlsx files using SheetJS with the exact column format required.
 *
 * Output format (columns A-K):
 *   A: Cód. Condomínio
 *   B: Cód. Bloco
 *   C: Cód. Unidade
 *   D: Vencimento
 *   E: (blank)
 *   F: (blank)
 *   G: Descrição
 *   H: Complemento (blank)
 *   I: Valor
 *   J: (blank)
 *   K: Nro. Bancário (blank)
 */

/**
 * Generate an Excel workbook from parsed data and configuration.
 * @param {Array} entries - Parsed entries [{ unit, competencia, description, value }]
 * @param {Object} config - Configuration options
 * @param {string} config.condoCode - Condominium code
 * @param {number} config.unitDigits - Number of digits for unit formatting
 * @param {string} config.dateFormat - Date format string
 * @param {Object} config.blockCodes - Map of block letter → code number (e.g., { A: 1, B: 2 })
 * @returns {Object} SheetJS workbook
 */
function generateExcelWorkbook(entries, config) {
    // Header row matching the exact Excel format
    const headers = [
        'Cód. Condomínio',  // A
        'Cód. Bloco',        // B
        'Cód. Unidade',      // C
        'Vencimento',         // D
        '',                   // E (blank)
        '',                   // F (blank)
        'Descrição',          // G
        'Complemento',        // H
        'Valor',              // I
        '',                   // J (blank)
        'Nro. Bancário'       // K
    ];

    const rows = [headers];

    for (const entry of entries) {
        const formattedUnit = formatUnit(entry.unit, config.unitDigits);
        const formattedDate = formatDate(entry.competencia, config.dateFormat);

        // Determine block code
        let blockCode = 0;
        if (config.blockCodes && Object.keys(config.blockCodes).length > 0) {
            // If blocks are configured, try to find the matching block
            // For now, use 0 (no block info in entry — will be enhanced for multi-block PDFs)
            blockCode = entry.block ? (config.blockCodes[entry.block] || 0) : 0;
        }

        // Parse condo code: try as number, fall back to string
        let condoCodeValue = config.condoCode;
        const condoNum = parseInt(config.condoCode);
        if (!isNaN(condoNum) && condoNum.toString() === config.condoCode.trim()) {
            condoCodeValue = condoNum;
        }

        rows.push([
            condoCodeValue,      // A: Cód. Condomínio
            blockCode,           // B: Cód. Bloco
            formattedUnit,       // C: Cód. Unidade (string to preserve leading zeros)
            formattedDate,       // D: Vencimento
            '',                  // E: blank
            '',                  // F: blank
            entry.description,   // G: Descrição
            '',                  // H: Complemento (blank)
            entry.value,         // I: Valor (number)
            '',                  // J: blank
            ''                   // K: Nro. Bancário (blank)
        ]);
    }

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Set column widths
    ws['!cols'] = [
        { wch: 18 },  // A: Cód. Condomínio
        { wch: 12 },  // B: Cód. Bloco
        { wch: 14 },  // C: Cód. Unidade
        { wch: 14 },  // D: Vencimento
        { wch: 5 },   // E: blank
        { wch: 5 },   // F: blank
        { wch: 32 },  // G: Descrição
        { wch: 14 },  // H: Complemento
        { wch: 14 },  // I: Valor
        { wch: 5 },   // J: blank
        { wch: 16 }   // K: Nro. Bancário
    ];

    // Force Cód. Unidade column (C) to be text to preserve leading zeros
    for (let r = 1; r <= entries.length; r++) {
        const cellRef = XLSX.utils.encode_cell({ r: r, c: 2 }); // Column C
        if (ws[cellRef]) {
            ws[cellRef].t = 's'; // Force string type
            ws[cellRef].z = '@'; // Text format
        }
    }

    // Force Valor column (I) to be number with 2 decimal places
    for (let r = 1; r <= entries.length; r++) {
        const cellRef = XLSX.utils.encode_cell({ r: r, c: 8 }); // Column I
        if (ws[cellRef] && typeof ws[cellRef].v === 'number') {
            ws[cellRef].t = 'n';
            ws[cellRef].z = '#,##0.00'; // Number format with 2 decimals
        }
    }

    // Add sheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Inadimplência');

    return wb;
}

/**
 * Generate and trigger download of the Excel file.
 * @param {Object} workbook - SheetJS workbook
 * @param {string} filename - Output filename
 */
function downloadExcel(workbook, filename) {
    XLSX.writeFile(workbook, filename);
}

/**
 * Derive the output filename from the PDF filename.
 * @param {string} pdfFilename - Original PDF filename
 * @returns {string} Excel filename
 */
function getExcelFilename(pdfFilename) {
    // Remove .pdf extension and add .xlsx
    const baseName = pdfFilename.replace(/\.pdf$/i, '');
    return `${baseName}.xlsx`;
}
