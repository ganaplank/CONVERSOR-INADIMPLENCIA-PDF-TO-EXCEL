/**
 * CondoConvert — Main Application
 * Handles wizard navigation, UI interactions, and data flow.
 */

(function () {
    'use strict';

    // ========================
    // State
    // ========================
    const state = {
        currentStep: 1,
        totalSteps: 4,
        pdfFiles: [],       // Array of files for batch processing
        parsedData: null,   // Merged data: { entries, units, blocks }
        config: {
            condoCode: '',
            unitDigits: 2,
            dateFormat: 'DD/MM/YYYY',
            blockCodes: {}
        },
        extractedTotal: 0,
        workbook: null
    };

    // ========================
    // DOM References
    // ========================
    const DOM = {
        // Steps
        stepIndicators: [
            document.getElementById('stepInd1'),
            document.getElementById('stepInd2'),
            document.getElementById('stepInd3'),
            document.getElementById('stepInd4')
        ],
        stepContents: [
            document.getElementById('stepContent1'),
            document.getElementById('stepContent2'),
            document.getElementById('stepContent3'),
            document.getElementById('stepContent4')
        ],
        connectors: document.querySelectorAll('.step-connector'),

        // Navigation
        btnBack: document.getElementById('btnBack'),
        btnNext: document.getElementById('btnNext'),
        navBar: document.getElementById('navBar'),

        // Step 1: Upload
        uploadZone: document.getElementById('uploadZone'),
        fileInput: document.getElementById('fileInput'),
        fileCard: document.getElementById('fileCard'),
        fileName: document.getElementById('fileName'),
        fileSize: document.getElementById('fileSize'),
        removeFile: document.getElementById('removeFile'),
        parsingStatus: document.getElementById('parsingStatus'),
        parsingStatusText: document.getElementById('parsingStatusText'),
        parseResult: document.getElementById('parseResult'),
        parseResultBadge: document.getElementById('parseResultBadge'),
        parseResultText: document.getElementById('parseResultText'),

        // Step 2: Configure
        condoCode: document.getElementById('condoCode'),
        unitDigits: document.getElementById('unitDigits'),
        dateFormat: document.getElementById('dateFormat'),
        unitPreview: document.getElementById('unitPreview'),
        unitPreviewItems: document.getElementById('unitPreviewItems'),
        blocksSection: document.getElementById('blocksSection'),
        blocksGrid: document.getElementById('blocksGrid'),

        // Step 3: Preview
        previewBody: document.getElementById('previewBody'),
        statRows: document.getElementById('statRows'),
        statUnits: document.getElementById('statUnits'),
        statComps: document.getElementById('statComps'),
        statTotal: document.getElementById('statTotal'),
        statPdfTotal: document.getElementById('statPdfTotal'),
        statDiff: document.getElementById('statDiff'),

        // Step 4: Download
        downloadBtn: document.getElementById('downloadBtn'),
        downloadFilename: document.getElementById('downloadFilename'),
        downloadSummary: document.getElementById('downloadSummary'),
        newConversionBtn: document.getElementById('newConversionBtn'),

        // Toast
        toastContainer: document.getElementById('toastContainer')
    };

    // ========================
    // Initialization
    // ========================
    function init() {
        loadConfigFromStorage();
        bindEvents();
        updateNavigation();
    }

    function loadConfigFromStorage() {
        try {
            const savedConfig = localStorage.getItem('condoConvertConfig');
            if (savedConfig) {
                const parsed = JSON.parse(savedConfig);
                state.config = { ...state.config, ...parsed };
                
                // Populate DOM with saved values
                if (state.config.condoCode) DOM.condoCode.value = state.config.condoCode;
                if (state.config.unitDigits) DOM.unitDigits.value = state.config.unitDigits;
                if (state.config.dateFormat) DOM.dateFormat.value = state.config.dateFormat;
            }
        } catch (e) {
            console.warn('Could not load config from localStorage', e);
        }
    }

    function saveConfigToStorage() {
        try {
            localStorage.setItem('condoConvertConfig', JSON.stringify(state.config));
        } catch (e) {
            console.warn('Could not save config to localStorage', e);
        }
    }

    function bindEvents() {
        // Navigation
        DOM.btnNext.addEventListener('click', goNext);
        DOM.btnBack.addEventListener('click', goBack);

        // Upload zone
        DOM.uploadZone.addEventListener('click', () => DOM.fileInput.click());
        DOM.uploadZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                DOM.fileInput.click();
            }
        });
        DOM.fileInput.addEventListener('change', handleFileSelect);
        DOM.removeFile.addEventListener('click', handleFileRemove);

        // Drag and drop
        DOM.uploadZone.addEventListener('dragover', handleDragOver);
        DOM.uploadZone.addEventListener('dragleave', handleDragLeave);
        DOM.uploadZone.addEventListener('drop', handleDrop);

        // Config inputs
        DOM.condoCode.addEventListener('input', handleCondoCodeChange);
        DOM.unitDigits.addEventListener('input', handleUnitDigitsChange);
        DOM.dateFormat.addEventListener('change', handleDateFormatChange);

        // Download
        DOM.downloadBtn.addEventListener('click', handleDownload);
        DOM.newConversionBtn.addEventListener('click', handleNewConversion);

        // Preview Validation
        if (DOM.statPdfTotal) {
            DOM.statPdfTotal.addEventListener('input', updateDiff);
        }

        // Keyboard navigation
        document.addEventListener('keydown', handleKeyNav);
    }

    // ========================
    // Wizard Navigation
    // ========================
    function goToStep(step) {
        if (step < 1 || step > state.totalSteps) return;

        // Hide current step content
        DOM.stepContents[state.currentStep - 1].classList.remove('active');

        // Update step indicators
        for (let i = 0; i < state.totalSteps; i++) {
            const indicator = DOM.stepIndicators[i];
            indicator.classList.remove('active', 'completed');

            if (i + 1 < step) {
                indicator.classList.add('completed');
            } else if (i + 1 === step) {
                indicator.classList.add('active');
            }
        }

        // Update connectors
        DOM.connectors.forEach((connector, i) => {
            if (i < step - 1) {
                connector.classList.add('filled');
            } else {
                connector.classList.remove('filled');
            }
        });

        // Show new step content
        state.currentStep = step;
        DOM.stepContents[step - 1].classList.remove('active');
        // Force reflow for animation
        void DOM.stepContents[step - 1].offsetWidth;
        DOM.stepContents[step - 1].classList.add('active');

        // Run step-specific logic
        onStepEnter(step);

        updateNavigation();
    }

    function goNext() {
        if (!canProceed()) return;
        if (state.currentStep < state.totalSteps) {
            goToStep(state.currentStep + 1);
        }
    }

    function goBack() {
        if (state.currentStep > 1) {
            goToStep(state.currentStep - 1);
        }
    }

    function canProceed() {
        switch (state.currentStep) {
            case 1:
                return state.parsedData !== null && state.parsedData.entries.length > 0;
            case 2:
                return state.config.condoCode.trim() !== '';
            case 3:
                return true;
            default:
                return false;
        }
    }

    function updateNavigation() {
        // Show/hide back button
        DOM.btnBack.hidden = state.currentStep === 1;

        // Show/hide next button (hide on last step)
        if (state.currentStep === state.totalSteps) {
            DOM.navBar.hidden = true;
        } else {
            DOM.navBar.hidden = false;
            DOM.btnNext.disabled = !canProceed();

            // Update next button text
            const nextLabel = DOM.btnNext.querySelector('span');
            if (state.currentStep === 3) {
                nextLabel.textContent = 'Gerar Excel';
            } else {
                nextLabel.textContent = 'Próximo';
            }
        }
    }

    function onStepEnter(step) {
        switch (step) {
            case 2:
                setupConfigStep();
                break;
            case 3:
                buildPreviewTable();
                break;
            case 4:
                generateAndPrepareDownload();
                break;
        }
    }

    // ========================
    // Step 1: Upload
    // ========================
    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        DOM.uploadZone.classList.add('drag-over');
    }

    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        DOM.uploadZone.classList.remove('drag-over');
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        DOM.uploadZone.classList.remove('drag-over');

        const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
        if (files.length > 0) {
            processFiles(files);
        } else {
            showToast('Nenhum arquivo PDF válido encontrado.', 'error');
        }
    }

    function handleFileSelect(e) {
        const files = Array.from(e.target.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
        if (files.length > 0) {
            processFiles(files);
        }
    }

    function handleFileRemove(e) {
        e.stopPropagation();
        state.pdfFiles = [];
        state.parsedData = null;
        DOM.fileCard.hidden = true;
        DOM.parseResult.hidden = true;
        DOM.parsingStatus.hidden = true;
        DOM.uploadZone.hidden = false;
        DOM.fileInput.value = '';
        updateNavigation();
    }

    async function processFiles(files) {
        state.pdfFiles = files;

        // Show file card
        DOM.uploadZone.hidden = true;
        DOM.fileCard.hidden = false;
        
        if (files.length === 1) {
            DOM.fileName.textContent = files[0].name;
            DOM.fileSize.textContent = formatFileSize(files[0].size);
        } else {
            DOM.fileName.textContent = `${files.length} PDFs selecionados`;
            const totalSize = files.reduce((acc, f) => acc + f.size, 0);
            DOM.fileSize.textContent = `Tamanho total: ${formatFileSize(totalSize)}`;
        }

        // Show parsing status
        DOM.parsingStatus.hidden = false;
        DOM.parseResult.hidden = true;
        DOM.parseResultBadge.classList.remove('error');

        const allEntries = [];
        const allUnits = new Set();
        const allBlocks = new Set();
        let totalPdfValue = 0;
        let errorCount = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            DOM.parsingStatusText.textContent = `Analisando PDF ${i + 1} de ${files.length}...`;
            
            try {
                // Parse the PDF
                const data = await parsePDF(file);
                
                // Merge data
                data.entries.forEach(e => allEntries.push(e));
                data.units.forEach(u => allUnits.add(u));
                data.blocks.forEach(b => allBlocks.add(b));
                totalPdfValue += (data.pdfTotal || 0);
            } catch (error) {
                console.error(`Error parsing PDF ${file.name}:`, error);
                errorCount++;
            }
        }

        DOM.parsingStatus.hidden = true;
        DOM.parseResult.hidden = false;

        // Save merged data
        state.parsedData = {
            entries: allEntries,
            units: Array.from(allUnits),
            blocks: Array.from(allBlocks).sort(),
            pdfTotal: totalPdfValue
        };

        if (allEntries.length === 0) {
            DOM.parseResultBadge.classList.add('error');
            DOM.parseResultText.textContent = 'Falha: formato de PDF desconhecido ou sem dados de inadimplência.';
            showToast('Não foi possível extrair dados dos PDFs.', 'error');
            state.parsedData = null; // Prevent proceeding
        } else {
            const unitCount = state.parsedData.units.length;
            const entryCount = state.parsedData.entries.length;
            
            let resultMsg = `${unitCount} unidade${unitCount !== 1 ? 's' : ''} em ${entryCount} linhas`;
            if (errorCount > 0) {
                resultMsg += ` (⚠️ ${errorCount} PDF${errorCount > 1 ? 's' : ''} falhou)`;
            }
            
            DOM.parseResultText.textContent = resultMsg;
            showToast(`Análise concluída com sucesso!`, 'success');
        }

        updateNavigation();
    }

    // ========================
    // Step 2: Configure
    // ========================
    function setupConfigStep() {
        // Read current config values (already populated from localStorage if available)
        state.config.condoCode = DOM.condoCode.value;
        state.config.unitDigits = parseInt(DOM.unitDigits.value) || 2;
        state.config.dateFormat = DOM.dateFormat.value;

        // Update unit preview with actual units from PDF
        updateUnitPreview();

        // Setup blocks if detected
        if (state.parsedData && state.parsedData.blocks.length > 0) {
            setupBlocksConfig();
        } else {
            DOM.blocksSection.hidden = true;
        }
    }

    function handleCondoCodeChange() {
        state.config.condoCode = DOM.condoCode.value.trim();
        saveConfigToStorage();
        updateNavigation();
    }

    function handleUnitDigitsChange() {
        state.config.unitDigits = parseInt(DOM.unitDigits.value) || 2;
        saveConfigToStorage();
        updateUnitPreview();
    }

    function handleDateFormatChange() {
        state.config.dateFormat = DOM.dateFormat.value;
        saveConfigToStorage();
    }

    function updateUnitPreview() {
        const digits = state.config.unitDigits;
        const previewContainer = DOM.unitPreviewItems;
        previewContainer.innerHTML = '';

        if (!state.parsedData || state.parsedData.units.length === 0) return;

        // Show preview for up to 5 units
        const unitsToShow = state.parsedData.units.slice(0, 5);
        for (const unit of unitsToShow) {
            const formatted = formatUnit(unit, digits);
            const item = document.createElement('div');
            item.className = 'unit-preview-item';
            item.innerHTML = `
                <span class="unit-original">${unit}</span>
                <span class="unit-arrow">→</span>
                <span>${formatted}</span>
            `;
            previewContainer.appendChild(item);
        }

        if (state.parsedData.units.length > 5) {
            const more = document.createElement('div');
            more.className = 'unit-preview-item';
            more.textContent = `+${state.parsedData.units.length - 5} mais...`;
            more.style.color = 'var(--text-muted)';
            previewContainer.appendChild(more);
        }
    }

    function setupBlocksConfig() {
        DOM.blocksSection.hidden = false;
        DOM.blocksGrid.innerHTML = '';

        for (const block of state.parsedData.blocks) {
            const item = document.createElement('div');
            item.className = 'block-item';
            item.innerHTML = `
                <span class="block-label">Bloco ${block} →</span>
                <input type="number" class="block-input" 
                       data-block="${block}" 
                       placeholder="Cód." 
                       min="0"
                       value="${state.config.blockCodes[block] || ''}">
            `;
            DOM.blocksGrid.appendChild(item);

            // Bind event
            const input = item.querySelector('.block-input');
            input.addEventListener('input', () => {
                state.config.blockCodes[block] = parseInt(input.value) || 0;
                saveConfigToStorage();
            });
        }
    }

    // ========================
    // Step 3: Preview
    // ========================
    function buildPreviewTable() {
        if (!state.parsedData) return;

        const entries = state.parsedData.entries;
        const config = state.config;
        const tbody = DOM.previewBody;
        tbody.innerHTML = '';

        let totalValue = 0;
        const uniqueUnits = new Set();
        const uniqueComps = new Set();

        for (const entry of entries) {
            const formattedUnit = formatUnit(entry.unit, config.unitDigits);
            const formattedDate = formatDate(entry.competencia, config.dateFormat);
            const blockCode = entry.block ? (config.blockCodes[entry.block] || 0) : 0;

            uniqueUnits.add(entry.unit);
            uniqueComps.add(`${entry.unit}-${entry.competencia}`);
            totalValue += entry.value;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${config.condoCode || '—'}</td>
                <td>${blockCode}</td>
                <td class="col-unit">${formattedUnit}</td>
                <td class="col-date">${formattedDate}</td>
                <td>${entry.description}</td>
                <td class="col-value">${formatCurrency(entry.value)}</td>
            `;
            tbody.appendChild(tr);
        }

        // Update stats
        DOM.statRows.textContent = entries.length;
        DOM.statUnits.textContent = uniqueUnits.size;
        DOM.statComps.textContent = uniqueComps.size;
        DOM.statTotal.textContent = `R$ ${formatCurrency(totalValue)}`;

        state.extractedTotal = totalValue;
        
        if (state.parsedData.pdfTotal > 0) {
            DOM.statPdfTotal.value = formatCurrency(state.parsedData.pdfTotal);
        } else {
            DOM.statPdfTotal.value = '';
        }
        updateDiff();
    }

    function updateDiff() {
        if (!DOM.statPdfTotal) return;
        const inputVal = DOM.statPdfTotal.value;
        
        if (!inputVal.trim()) {
            DOM.statDiff.textContent = 'Aguardando valor...';
            DOM.statDiff.className = 'stat-diff';
            return;
        }

        const pdfVal = parseMoneyValue(inputVal);
        const diff = Math.abs(state.extractedTotal - pdfVal);

        if (diff < 0.05) {
            DOM.statDiff.textContent = '✅ Bateu (Dif: R$ 0,00)';
            DOM.statDiff.className = 'stat-diff diff-ok';
        } else {
            DOM.statDiff.textContent = `❌ Dif: R$ ${formatCurrency(diff)}`;
            DOM.statDiff.className = 'stat-diff diff-error';
        }
    }

    // ========================
    // Step 4: Download
    // ========================
    function generateAndPrepareDownload() {
        if (!state.parsedData) return;

        try {
            state.workbook = generateExcelWorkbook(state.parsedData.entries, state.config);

            const filename = getExcelFilename(state.pdfFiles.length === 1 ? state.pdfFiles[0].name : `Inadimplencia_Multi_${state.config.condoCode}.pdf`);
            DOM.downloadFilename.textContent = filename;

            // Summary
            const uniqueUnits = new Set(state.parsedData.entries.map(e => e.unit));
            DOM.downloadSummary.innerHTML = `
                <span><span class="summary-num">${state.parsedData.entries.length}</span> linhas</span>
                <span><span class="summary-num">${uniqueUnits.size}</span> unidades</span>
            `;
        } catch (error) {
            console.error('Error generating Excel:', error);
            showToast('Erro ao gerar o Excel.', 'error');
        }
    }

    function handleDownload() {
        if (!state.workbook || state.pdfFiles.length === 0) return;

        try {
            const filename = getExcelFilename(state.pdfFiles.length === 1 ? state.pdfFiles[0].name : `Inadimplencia_Multi_${state.config.condoCode}.pdf`);
            downloadExcel(state.workbook, filename);
            showToast('Excel baixado com sucesso!', 'success');
        } catch (error) {
            console.error('Download error:', error);
            showToast('Erro ao baixar o arquivo.', 'error');
        }
    }

    function handleNewConversion() {
        // Reset state
        state.pdfFiles = [];
        state.parsedData = null;
        state.workbook = null;

        // Reset UI
        DOM.fileCard.hidden = true;
        DOM.parseResult.hidden = true;
        DOM.parsingStatus.hidden = true;
        DOM.uploadZone.hidden = false;
        DOM.fileInput.value = '';
        DOM.previewBody.innerHTML = '';

        // Go to step 1
        goToStep(1);
    }

    // ========================
    // Keyboard Navigation
    // ========================
    function handleKeyNav(e) {
        // Don't intercept when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        if (e.key === 'ArrowRight' || e.key === 'Enter') {
            if (canProceed() && state.currentStep < state.totalSteps) {
                e.preventDefault();
                goNext();
            }
        } else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
            if (state.currentStep > 1) {
                e.preventDefault();
                goBack();
            }
        }
    }

    // ========================
    // Utilities
    // ========================
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function formatCurrency(value) {
        return value.toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
        toast.innerHTML = `
            <span class="toast-icon">${icon}</span>
            <span>${message}</span>
        `;

        DOM.toastContainer.appendChild(toast);

        // Auto-remove after 4 seconds
        setTimeout(() => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // ========================
    // Start
    // ========================
    init();
})();
