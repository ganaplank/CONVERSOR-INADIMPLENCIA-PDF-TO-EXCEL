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
        pdfFile: null,
        parsedData: null,   // { entries, units, blocks }
        config: {
            condoCode: '',
            unitDigits: 2,
            dateFormat: 'DD/MM/YYYY',
            blockCodes: {}
        },
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
        bindEvents();
        updateNavigation();
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

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processFile(files[0]);
        }
    }

    function handleFileSelect(e) {
        const files = e.target.files;
        if (files.length > 0) {
            processFile(files[0]);
        }
    }

    function handleFileRemove(e) {
        e.stopPropagation();
        state.pdfFile = null;
        state.parsedData = null;
        DOM.fileCard.hidden = true;
        DOM.parseResult.hidden = true;
        DOM.parsingStatus.hidden = true;
        DOM.uploadZone.hidden = false;
        DOM.fileInput.value = '';
        updateNavigation();
    }

    async function processFile(file) {
        // Validate file type
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            showToast('Por favor, selecione um arquivo PDF.', 'error');
            return;
        }

        state.pdfFile = file;

        // Show file card
        DOM.uploadZone.hidden = true;
        DOM.fileCard.hidden = false;
        DOM.fileName.textContent = file.name;
        DOM.fileSize.textContent = formatFileSize(file.size);

        // Show parsing status
        DOM.parsingStatus.hidden = false;
        DOM.parseResult.hidden = true;

        try {
            // Parse the PDF
            const data = await parsePDF(file);
            state.parsedData = data;

            DOM.parsingStatus.hidden = true;
            DOM.parseResult.hidden = false;

            if (data.entries.length === 0) {
                DOM.parseResultBadge.classList.add('error');
                DOM.parseResultText.textContent = 'Nenhum dado de inadimplência encontrado neste PDF.';
                showToast('Não foi possível extrair dados deste PDF.', 'error');
            } else {
                DOM.parseResultBadge.classList.remove('error');
                const unitCount = data.units.length;
                const entryCount = data.entries.length;
                DOM.parseResultText.textContent =
                    `${unitCount} unidade${unitCount !== 1 ? 's' : ''} encontrada${unitCount !== 1 ? 's' : ''} · ${entryCount} itens extraídos`;

                showToast(`PDF analisado com sucesso! ${unitCount} unidades encontradas.`, 'success');
            }
        } catch (error) {
            console.error('Error parsing PDF:', error);
            DOM.parsingStatus.hidden = true;
            DOM.parseResult.hidden = false;
            DOM.parseResultBadge.classList.add('error');
            DOM.parseResultText.textContent = 'Erro ao ler o PDF. Verifique se é um PDF válido.';
            showToast('Erro ao processar o PDF.', 'error');
        }

        updateNavigation();
    }

    // ========================
    // Step 2: Configure
    // ========================
    function setupConfigStep() {
        // Read current config values
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
        updateNavigation();
    }

    function handleUnitDigitsChange() {
        state.config.unitDigits = parseInt(DOM.unitDigits.value) || 2;
        updateUnitPreview();
    }

    function handleDateFormatChange() {
        state.config.dateFormat = DOM.dateFormat.value;
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
    }

    // ========================
    // Step 4: Download
    // ========================
    function generateAndPrepareDownload() {
        if (!state.parsedData) return;

        try {
            state.workbook = generateExcelWorkbook(state.parsedData.entries, state.config);

            const filename = getExcelFilename(state.pdfFile.name);
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
        if (!state.workbook || !state.pdfFile) return;

        try {
            const filename = getExcelFilename(state.pdfFile.name);
            downloadExcel(state.workbook, filename);
            showToast('Excel baixado com sucesso!', 'success');
        } catch (error) {
            console.error('Download error:', error);
            showToast('Erro ao baixar o arquivo.', 'error');
        }
    }

    function handleNewConversion() {
        // Reset state
        state.pdfFile = null;
        state.parsedData = null;
        state.workbook = null;
        state.config.condoCode = '';
        state.config.blockCodes = {};

        // Reset UI
        DOM.fileCard.hidden = true;
        DOM.parseResult.hidden = true;
        DOM.parsingStatus.hidden = true;
        DOM.uploadZone.hidden = false;
        DOM.fileInput.value = '';
        DOM.condoCode.value = '';
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
