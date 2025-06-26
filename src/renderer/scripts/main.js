// Application state
let currentTranslation = null;
let translationHistory = JSON.parse(localStorage.getItem('translationHistory') || '[]');
let availableLanguages = [];
let googleCloudConfigured = false;
let currentResultData = null; // Store data for re-translation

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    await loadSupportedLanguages();
    await checkGoogleCloudStatus();
    await updateAppVersion();
    loadHistory();
    setupEventListeners();
    showSection('home');
});

// Update app version in UI
async function updateAppVersion() {
    try {
        const version = await window.electronAPI.getAppVersion();
        const versionElements = document.querySelectorAll('.app-version');
        versionElements.forEach(el => {
            el.textContent = `Version ${version}`;
        });
    } catch (error) {
        console.error('Failed to get app version:', error);
    }
}

// Setup event listeners
function setupEventListeners() {
    // Navigation
    document.querySelectorAll('[data-section]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = e.currentTarget.getAttribute('data-section');
            showSection(section);
        });
    });

    // Capture buttons (both sidebar and main)
    const captureButtons = ['captureBtn'];
    captureButtons.forEach(buttonId => {
        const button = document.getElementById(buttonId);
        if (button) {
            button.addEventListener('click', startCapture);
        }
    });

    // Quick action buttons in sidebar
    const quickActions = document.querySelectorAll('.quick-action');
    quickActions.forEach((action, index) => {
        action.addEventListener('click', () => {
            switch (index) {
                case 0: // New Capture
                    startCapture();
                    break;
                case 1: // View Recent
                    showSection('history');
                    break;
                case 2: // Export All
                    showToast('Export all feature coming soon!', 'info');
                    break;
            }
        });
    });

    // Upgrade button
    const upgradeBtn = document.getElementById('sidebarUpgradeBtn');
    if (upgradeBtn) {
        upgradeBtn.addEventListener('click', () => {
            showToast('Upgrade feature is coming soon!', 'info');
        });
    }

    // Settings form
    const settingsForm = document.getElementById('settingsForm');
    if (settingsForm) {
        settingsForm.addEventListener('submit', saveSettings);
    }

    // Clear history button
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', clearHistory);
    }

    // Use event delegation for dynamically visible buttons
    document.body.addEventListener('click', (e) => {
        // Retranslate button in modal
        if (e.target.id === 'retranslateBtn') {
            retranslateCurrentResult();
        }

        // Handle plan upgrade clicks from the plans page
        if (e.target.matches('.plan-button.upgrade')) {
            e.preventDefault();
            showToast('Upgrade feature is coming soon!', 'info');
        }

        // Handle About page links
        if (e.target.matches('.about-link')) {
            e.preventDefault();
            const linkType = e.target.getAttribute('data-link');
            let url;
            switch (linkType) {
                case 'bug':
                    url = 'https://gloding.com/contact';
                    break;
                case 'website':
                    url = 'https://gloding.com';
                    break;
                case 'check-update':
                    showToast('You are using the latest version!', 'success');
                    return;
            }
            if (url && window.electronAPI && window.electronAPI.openExternalLink) {
                window.electronAPI.openExternalLink(url);
            }
        }
    });

    // Listen for capture completion
    window.electronAPI.onCaptureComplete((result) => {
        handleCaptureComplete(result);
    });

    // Listen for 'About' from menu
    window.electronAPI.onShowAboutPage(() => {
        showSection('about');
    });

    // Listen for menu item to clear history
    window.electronAPI.onClearHistory(() => {
        clearHistory();
    });

    // Listen for toast messages from main process
    if (window.electronAPI.onShowToast) {
        window.electronAPI.onShowToast((data) => {
            showToast(data.message, data.type);
        });
    }

    // Listen for request to reset UI to home screen
    window.electronAPI.onResetToHome(() => {
        closeModal();
    });

    // Listen for trigger-capture event from menu
    if (window.electronAPI.onTriggerCapture) {
        window.electronAPI.onTriggerCapture(() => {
            startCapture();
        });
    }

    // Plans page buttons
    const upgradeButtons = document.querySelectorAll('.plan-button.upgrade');
    if (upgradeButtons) {
        upgradeButtons.forEach(button => {
            button.addEventListener('click', () => {
                showToast('Upgrade feature is coming soon!', 'info');
            });
        });
    }

    // Modal close button
    const closeModalBtn = document.getElementById('closeModal');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeModal);
    }

    // Save buttons
    const saveTextBtn = document.getElementById('saveTextBtn');
    if (saveTextBtn) {
        saveTextBtn.addEventListener('click', async () => {
            if (currentResultData) {
                const content = `Original Text:\n${currentResultData.originalText}\n\nTranslated Text:\n${currentResultData.translatedText}`;
                const filename = `translation_${Date.now()}.txt`;
                
                const result = await window.electronAPI.saveResult({
                    type: 'text',
                    data: content,
                    filename
                });
                
                if (result.success) {
                    showSuccess('Text saved successfully!');
                } else {
                    showError('Failed to save text');
                }
            }
        });
    }

    const saveImageBtn = document.getElementById('saveImageBtn');
    if (saveImageBtn) {
        saveImageBtn.addEventListener('click', async () => {
            if (currentResultData) {
                try {
                    showLoading(true);
                    
                    // Create image with translated text overlay in exact positions
                    const translatedImageResult = await window.electronAPI.createTranslatedImage({
                        originalImagePath: currentResultData.imagePath,
                        originalText: currentResultData.originalText,
                        translatedText: currentResultData.translatedText,
                        textBlocks: currentResultData.textBlocks || []
                    });
                    
                    if (translatedImageResult.success) {
                        const filename = `translated_image_${Date.now()}.png`;
                        
                        const result = await window.electronAPI.saveResult({
                            type: 'image',
                            data: translatedImageResult.imagePath,
                            filename
                        });
                        
                        if (result.success) {
                            showSuccess('Google Translate-style image saved successfully!');
                        } else {
                            showError('Failed to save translated image');
                        }
                    } else {
                        showError('Failed to create translated image: ' + translatedImageResult.error);
                    }
                } catch (error) {
                    showError('Error creating translated image: ' + error.message);
                } finally {
                    showLoading(false);
                }
            }
        });
    }

    // API setup link
    const apiSetupLink = document.getElementById('apiSetupLink');
    if (apiSetupLink) {
        apiSetupLink.addEventListener('click', (e) => {
            e.preventDefault();
            showAPISetupInstructions();
        });
    }

    const apiSetupLinkLegacy = document.getElementById('apiSetupLinkLegacy');
    if (apiSetupLinkLegacy) {
        apiSetupLinkLegacy.addEventListener('click', (e) => {
            e.preventDefault();
            showAPISetupInstructions();
        });
    }

    // ESC key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });

    // Setup shortcuts management
    setupShortcutsPage();
}

// Setup shortcuts management page
async function setupShortcutsPage() {
    const shortcutInputs = {
        'capture-translate': document.getElementById('capture-translate'),
        'translate-paste': document.getElementById('translate-paste'),
        'copy-last-translation': document.getElementById('copy-last-translation')
    };
    const resetButton = document.getElementById('reset-shortcuts-button');

    let currentShortcuts = {};
    let activeInput = null;

    // Load current shortcuts
    try {
        currentShortcuts = await window.electronAPI.getShortcuts();
        updateShortcutDisplay();
    } catch (error) {
        console.error('Failed to load shortcuts:', error);
    }

    function updateShortcutDisplay() {
        Object.entries(shortcutInputs).forEach(([key, input]) => {
            if (input && currentShortcuts[key]) {
                input.value = formatShortcutForDisplay(currentShortcuts[key]);
            }
        });
    }

    function formatShortcutForDisplay(shortcut) {
        return shortcut
            .replace(/CommandOrControl/g, '⌘')
            .replace(/Shift/g, '⇧')
            .replace(/Alt/g, '⌥')
            .replace(/Control/g, '⌃')
            .replace(/\+/g, ' + ');
    }

    function formatShortcutForStorage(keys) {
        const modifiers = [];
        const regularKeys = [];

        keys.forEach(key => {
            if (key === 'Meta' || key === 'cmd') {
                modifiers.push('CommandOrControl');
            } else if (key === 'Shift') {
                modifiers.push('Shift');
            } else if (key === 'Alt') {
                modifiers.push('Alt');
            } else if (key === 'Control') {
                modifiers.push('Control');
            } else if (key.length === 1 && /[a-zA-Z0-9]/.test(key)) {
                regularKeys.push(key.toUpperCase());
            } else if (key.startsWith('Key')) {
                regularKeys.push(key.substring(3));
            } else if (key.startsWith('Digit')) {
                regularKeys.push(key.substring(5));
            } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
                regularKeys.push(key.replace('Arrow', ''));
            } else if (['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].includes(key)) {
                regularKeys.push(key);
            } else if (['Space', 'Tab', 'Enter', 'Escape', 'Backspace', 'Delete'].includes(key)) {
                regularKeys.push(key);
            } else if (key.length === 1) {
                // Handle other single character keys
                regularKeys.push(key.toUpperCase());
            }
        });

        // Must have at least one regular key
        if (regularKeys.length === 0) {
            return null; // Invalid shortcut
        }

        // Remove duplicates while preserving order
        const uniqueModifiers = [...new Set(modifiers)];
        const uniqueRegularKeys = [...new Set(regularKeys)];

        // Standard order: CommandOrControl, Alt, Shift, then regular keys
        const orderedModifiers = [];
        if (uniqueModifiers.includes('CommandOrControl')) orderedModifiers.push('CommandOrControl');
        if (uniqueModifiers.includes('Alt')) orderedModifiers.push('Alt');
        if (uniqueModifiers.includes('Shift')) orderedModifiers.push('Shift');
        if (uniqueModifiers.includes('Control')) orderedModifiers.push('Control');

        return [...orderedModifiers, ...uniqueRegularKeys].join('+');
    }

    // Add event listeners for shortcut inputs
    Object.entries(shortcutInputs).forEach(([key, input]) => {
        if (input) {
            input.addEventListener('click', () => {
                startRecording(key, input);
            });

            input.addEventListener('focus', () => {
                startRecording(key, input);
            });
        }
    });

    function startRecording(key, input) {
        if (activeInput) {
            stopRecording();
        }

        activeInput = input;
        input.classList.add('recording');
        input.value = 'Press keys...';
        input.placeholder = 'Recording...';

        // Tell the main process to disable global shortcuts
        window.electronAPI.setShortcutsRecording(true);

        const recordedKeys = new Set();

        const keyDownHandler = (e) => {
            e.preventDefault();
            recordedKeys.add(e.key);
            input.value = Array.from(recordedKeys).join(' + ');
        };

        const keyUpHandler = (e) => {
            e.preventDefault();
            
            if (recordedKeys.size > 0) {
                const shortcut = formatShortcutForStorage(Array.from(recordedKeys));
                if (shortcut && shortcut.length > 0) {
                    currentShortcuts[key] = shortcut;
                    input.value = formatShortcutForDisplay(shortcut);
                    saveShortcuts();
                } else {
                    // Invalid shortcut - show error message
                    input.value = 'Invalid shortcut - try again';
                    input.style.color = '#e53e3e';
                    setTimeout(() => {
                        input.value = currentShortcuts[key] ? formatShortcutForDisplay(currentShortcuts[key]) : '';
                        input.style.color = '';
                    }, 2000);
                }
            }
            
            stopRecording();
        };

        function stopRecording() {
            if (activeInput) {
                activeInput.classList.remove('recording');
                activeInput.removeEventListener('keydown', keyDownHandler);
                activeInput.removeEventListener('keyup', keyUpHandler);
                activeInput = null;
                
                // Tell the main process to re-enable global shortcuts
                window.electronAPI.setShortcutsRecording(false);
            }
        }

        input.addEventListener('keydown', keyDownHandler);
        input.addEventListener('keyup', keyUpHandler);
        
        // Stop recording if clicked outside
        const clickHandler = (e) => {
            if (!input.contains(e.target)) {
                stopRecording();
                document.removeEventListener('click', clickHandler);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', clickHandler);
        }, 100);
    }

    async function saveShortcuts() {
        try {
            await window.electronAPI.setShortcuts(currentShortcuts);
            showSuccess('Shortcuts updated successfully!');
        } catch (error) {
            console.error('Failed to save shortcuts:', error);
            showError('Failed to save shortcuts');
        }
    }

    // Reset button handler
    if (resetButton) {
        resetButton.addEventListener('click', async () => {
            try {
                currentShortcuts = await window.electronAPI.resetShortcuts();
                updateShortcutDisplay();
                showSuccess('Shortcuts reset to defaults!');
            } catch (error) {
                console.error('Failed to reset shortcuts:', error);
                showError('Failed to reset shortcuts');
            }
        });
    }
}

// Navigation between sections
function showSection(sectionName) {
    // Hide all main content sections first
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Then, show the target section
    const targetSection = document.getElementById(sectionName);
    if (targetSection) {
        targetSection.classList.add('active');
    }
    
    // Finally, update the active state for all navigation links by
    // targeting the parent '.nav-item' which the CSS rule expects.
    document.querySelectorAll('.sidebar .nav-link[data-section]').forEach(link => {
        const navItem = link.closest('.nav-item');
        if (navItem) {
            if (link.getAttribute('data-section') === sectionName) {
                navItem.classList.add('active');
            } else {
                navItem.classList.remove('active');
            }
        }
    });
}

// Start capture process
async function startCapture() {
    try {
        showLoading(true);
        const result = await window.electronAPI.startCapture();
        
        if (!result.success) {
            showError('Failed to start capture: ' + result.error);
        }
    } catch (error) {
        showError('Error starting capture: ' + error.message);
    } finally {
        showLoading(false);
    }
}

async function loadSupportedLanguages() {
    try {
        availableLanguages = await window.electronAPI.getLanguages();
        populateLanguageSelects();
    } catch (error) {
        console.error('Error loading languages:', error);
        // Use fallback languages
        availableLanguages = [
            { code: 'en', name: 'English' },
            { code: 'es', name: 'Spanish' },
            { code: 'fr', name: 'French' },
            { code: 'de', name: 'German' },
            { code: 'ja', name: 'Japanese' },
            { code: 'ko', name: 'Korean' },
            { code: 'zh-CN', name: 'Chinese (Simplified)' }
        ];
        populateLanguageSelects();
    }
}

function populateLanguageSelects() {
    const selects = [
        document.getElementById('defaultLanguage'),
        document.getElementById('targetLanguageSelect')
    ];

    selects.forEach(select => {
        if (select) {
            select.innerHTML = '';
            availableLanguages.forEach(lang => {
                const option = document.createElement('option');
                option.value = lang.code;
                option.textContent = lang.name;
                
                // Set Japanese as default for defaultLanguage select
                if (select.id === 'defaultLanguage' && lang.code === 'ja') {
                    option.selected = true;
                }
                
                select.appendChild(option);
            });
        }
    });
    
    // Also ensure we store the default language
    if (!localStorage.getItem('targetLanguage')) {
        localStorage.setItem('targetLanguage', 'ja');
    }
    
    loadSettings();
}

function loadHistory() {
    const historyList = document.getElementById('historyList');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    
    if (translationHistory.length === 0) {
        historyList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-history"></i>
                <h3>No translations yet</h3>
                <p>Start capturing and translating to see your history here</p>
            </div>
        `;
        
        // Hide clear button when no history
        if (clearHistoryBtn) {
            clearHistoryBtn.style.display = 'none';
        }
        return;
    }
    
    // Show clear button when history exists
    if (clearHistoryBtn) {
        clearHistoryBtn.style.display = 'inline-flex';
    }
    
    historyList.innerHTML = translationHistory.map((item, index) => {
        const date = new Date(item.timestamp);
        const formattedDate = date.getFullYear() + '-' + 
            String(date.getMonth() + 1).padStart(2, '0') + '-' + 
            String(date.getDate()).padStart(2, '0') + ' ' + 
            String(date.getHours()).padStart(2, '0') + ':' + 
            String(date.getMinutes()).padStart(2, '0');
        
        const detectedLang = getLanguageName(item.detectedLanguage || 'unknown');
        const targetLang = getLanguageName(item.targetLanguage || 'unknown');
        
        return `
            <div class="history-item" data-index="${index}" title="Click to view details">
                <div class="history-header">
                    <div class="history-date-lang">
                        <div class="history-date">${formattedDate}</div>
                        <div class="history-languages">${detectedLang} → ${targetLang}</div>
                    </div>
                    <div class="history-actions">
                        <button class="history-copy-btn" data-index="${index}" title="Copy Options">
                            <i class="fas fa-copy"></i>
                        </button>
                        <div class="history-copy-dropdown" id="historyDropdown${index}">
                            ${item.imagePath ? `
                                <button class="copy-option" onclick="copyHistoryItem(${index}, 'originalImage')">
                                    <i class="fas fa-image"></i> Copy Original Image
                                </button>
                            ` : ''}
                            <button class="copy-option" onclick="copyHistoryItem(${index}, 'originalText')">
                                <i class="fas fa-file-text"></i> Copy Original Text
                            </button>
                            ${item.imagePath ? `
                                <button class="copy-option" onclick="copyHistoryItem(${index}, 'translatedImage')">
                                    <i class="fas fa-images"></i> Copy Translated Image
                                </button>
                            ` : ''}
                            <button class="copy-option" onclick="copyHistoryItem(${index}, 'translatedText')">
                                <i class="fas fa-language"></i> Copy Translated Text
                            </button>
                        </div>
                    </div>
                </div>
                <div class="history-text">
                    <div class="original-text">
                        <strong>Original:</strong> ${item.originalText.substring(0, 150)}${item.originalText.length > 150 ? '...' : ''}
                    </div>
                    <div class="translated-text">
                        <strong>Translated:</strong> ${item.translatedText.substring(0, 150)}${item.translatedText.length > 150 ? '...' : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Add event listener for each history item to open the modal
    document.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't trigger if a button inside the item was clicked
            if (e.target.closest('.history-actions')) {
                return;
            }
            const index = item.getAttribute('data-index');
            const historyData = translationHistory[index];
            if (historyData) {
                currentResultData = historyData; // Set the current data
                showTranslationResult(historyData);
            }
        });
    });

    // Add event listeners for copy buttons
    document.querySelectorAll('.history-copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = btn.getAttribute('data-index');
            const dropdown = document.getElementById(`historyDropdown${index}`);
            
            // Close all other dropdowns
            document.querySelectorAll('.history-copy-dropdown').forEach(d => {
                if (d !== dropdown) d.style.display = 'none';
            });
            
            // Toggle current dropdown
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        });
    });
    
    // Close dropdowns when clicking elsewhere
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.history-actions')) {
            document.querySelectorAll('.history-copy-dropdown').forEach(d => {
                d.style.display = 'none';
            });
        }
    });
}

function showTranslationResult(translation) {
    const modal = document.getElementById('resultsModal');
    const originalTextEl = document.getElementById('originalText');
    const translatedTextEl = document.getElementById('translatedText');
    const modalHeader = document.querySelector('#resultsModal .modal-header h2');
    const targetLanguageSelect = document.getElementById('targetLanguageSelect');
    const retranslateBtn = document.getElementById('retranslateBtn');

    if (!modal || !originalTextEl || !translatedTextEl || !modalHeader || !targetLanguageSelect || !retranslateBtn) {
        console.error('One or more modal elements are missing from the DOM.');
        return;
    }
    
    originalTextEl.textContent = translation.originalText;
    translatedTextEl.textContent = translation.translatedText;
    
    const detectedName = getLanguageName(translation.detectedLanguage);
    const targetName = getLanguageName(translation.targetLanguage);
    modalHeader.textContent = `Translation Results (${detectedName} → ${targetName})`;
    
    targetLanguageSelect.value = translation.targetLanguage;

    retranslateBtn.disabled = !translation.textBlocks || translation.textBlocks.length === 0;

    modal.classList.add('active');
}

// Helper function to get language name from code
function getLanguageName(code) {
    const languageNames = {
        'en': 'English',
        'ja': 'Japanese',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'ko': 'Korean',
        'zh': 'Chinese',
        'zh-CN': 'Chinese (Simplified)',
        'zh-TW': 'Chinese (Traditional)',
        'ar': 'Arabic',
        'hi': 'Hindi',
        'th': 'Thai',
        'vi': 'Vietnamese',
        'tr': 'Turkish',
        'pt': 'Portuguese',
        'ru': 'Russian',
        'it': 'Italian',
        'nl': 'Dutch',
        'sv': 'Swedish',
        'da': 'Danish',
        'no': 'Norwegian',
        'fi': 'Finnish'
    };
    
    return languageNames[code] || code.toUpperCase();
}

function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (show) {
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

function hideLoading() {
    showLoading(false);
}

function showError(message) {
    showToast(message, 'error');
}

function showSuccess(message) {
    showToast(message, 'success');
}

function showToast(message, type = 'info') {
    // Remove existing toast if any
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
        existingToast.remove();
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    
    let iconClass = 'fa-info-circle';
    let iconColor = '#1E95D4';

    switch (type) {
        case 'success':
            iconClass = 'fa-check-circle';
            iconColor = '#48bb78';
            break;
        case 'error':
            iconClass = 'fa-exclamation-circle';
            iconColor = '#e53e3e';
            break;
    }
    
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fas ${iconClass}"></i>
        </div>
        <div class="toast-content">
            <p class="toast-message">${message}</p>
        </div>
        <div class="toast-progress"></div>
    `;
    
    document.body.appendChild(toast);
    
    toast.querySelector('.toast-icon i').style.color = iconColor;

    // Animate in
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        // Remove from DOM after animation ends
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

function saveSettings(e) {
    e.preventDefault();
    const settings = {
        defaultLanguage: document.getElementById('defaultLanguage').value,
        autoDetect: document.getElementById('autoDetect').checked,
        captureQuality: document.getElementById('captureQuality').value
    };
    
    localStorage.setItem('translatorpad-settings', JSON.stringify(settings));
    localStorage.setItem('targetLanguage', settings.defaultLanguage);
    showSuccess('Settings saved successfully!');
}

function loadSettings() {
    const settings = JSON.parse(localStorage.getItem('translatorpad-settings') || '{}');
    
    if (settings.defaultLanguage) {
        const select = document.getElementById('defaultLanguage');
        if (select) {
            select.value = settings.defaultLanguage;
        }
    }
    
    if (settings.autoDetect !== undefined) {
        const checkbox = document.getElementById('autoDetect');
        if (checkbox) {
            checkbox.checked = settings.autoDetect;
        }
    }
    
    if (settings.captureQuality) {
        const select = document.getElementById('captureQuality');
        if (select) {
            select.value = settings.captureQuality;
        }
    }
}

function showAPISetupInstructions() {
    const instructions = `
🔧 Google Cloud API Setup Guide

To enable text extraction and translation features:

STEP 1: Create Google Cloud Project
• Go to https://console.cloud.google.com
• Click "Create Project" or select existing project
• Name it (e.g., "TranslatorPad AI")

STEP 2: Enable APIs
• Go to "APIs & Services" > "Library"
• Search and enable:
  - Cloud Vision API
  - Cloud Translation API

STEP 3: Create Service Account
• Go to "APIs & Services" > "Credentials"
• Click "Create Credentials" > "Service Account"
• Name: translatorpad-service
• Grant roles:
  - Cloud Vision API Service Agent
  - Cloud Translation API Service Agent

STEP 4: Download JSON Key
• Click your service account email
• Go to "Keys" tab
• Click "Add Key" > "Create New Key"
• Choose JSON format and download

STEP 5: Place Credentials
• Copy the downloaded JSON file to:
  credentials/google-cloud-key.json
• Restart the app

💡 The first 1,000 Vision API calls and 500,000 translation characters per month are FREE!

Need help? Check the README.md for detailed instructions.
`;

    alert(instructions);
}

// Handle capture completion
function handleCaptureComplete(result) {
    showLoading(false);

    if (result.success) {
        currentResultData = result; // Store the complete result object
        showTranslationResult(result);
        addToHistory(result);
    } else {
        showError('Capture failed: ' + result.error);
    }
}

// Modal controls
function closeModal() {
    document.getElementById('resultsModal').classList.remove('active');
}

// Check Google Cloud API status
async function checkGoogleCloudStatus() {
    try {
        // Try a simple API call to check if credentials work
        const languages = await window.electronAPI.getLanguages();
        if (languages && languages.length > 10) {
            googleCloudConfigured = true;
            updateApiStatus(true, 'Google Cloud APIs are configured and working');
        } else {
            googleCloudConfigured = false;
            updateApiStatus(false, 'Google Cloud APIs not configured - using fallback mode');
        }
    } catch (error) {
        googleCloudConfigured = false;
        updateApiStatus(false, 'Google Cloud APIs not configured - text extraction and translation will not work');
    }
}

// Update API status indicator
function updateApiStatus(isConfigured, message) {
    const statusElement = document.getElementById('apiStatus');
    if (statusElement) {
        statusElement.className = `api-status ${isConfigured ? 'configured' : 'not-configured'}`;
        statusElement.innerHTML = `
            <i class="fas ${isConfigured ? 'fa-check-circle' : 'fa-exclamation-triangle'}"></i>
            <span>${message}</span>
            ${!isConfigured ? '<a href="#" id="setupGuideLink">Setup Guide</a>' : ''}
        `;
        
        // Add click handler for setup guide
        const setupLink = document.getElementById('setupGuideLink');
        if (setupLink) {
            setupLink.addEventListener('click', (e) => {
                e.preventDefault();
                showAPISetupInstructions();
            });
        }
    }
}

async function clearHistory() {
    const result = await window.electronAPI.showClearHistoryDialog();
    if (result.response === 0) { // This means the first button ('Yes') was clicked
        translationHistory = [];
        localStorage.setItem('translationHistory', JSON.stringify(translationHistory));
        loadHistory(); // Reload the history view to show the empty state
        showToast('Translation history cleared successfully!', 'success');
    }
}

// Copy function for history items
async function copyHistoryItem(index, type) {
    const item = translationHistory[index];
    if (!item) {
        showError('History item not found');
        return;
    }
    
    // Close the dropdown
    const dropdown = document.getElementById(`historyDropdown${index}`);
    if (dropdown) {
        dropdown.style.display = 'none';
    }
    
    try {
        switch (type) {
            case 'originalText':
                await window.electronAPI.copyAsText(item.originalText);
                showSuccess('Original text copied to clipboard!');
                break;
                
            case 'translatedText':
                await window.electronAPI.copyAsText(item.translatedText);
                showSuccess('Translated text copied to clipboard!');
                break;
                
            case 'originalImage':
                if (item.imagePath) {
                    // Request original image from main process
                    const result = await window.electronAPI.getOriginalImageForCopy(item.imagePath);
                    if (result.success) {
                        await window.electronAPI.copyAsImage(result.imageDataUrl);
                        showSuccess('Original image copied to clipboard!');
                    } else {
                        showError('Failed to load original image: ' + result.error);
                    }
                } else {
                    showError('Original image not available');
                }
                break;
                
            case 'translatedImage':
                if (item.imagePath && item.textBlocks) {
                    // Create translated image
                    const result = await window.electronAPI.createTranslatedImage({
                        originalImagePath: item.imagePath,
                        originalText: item.originalText,
                        translatedText: item.translatedText,
                        textBlocks: item.textBlocks || []
                    });
                    
                    if (result.success) {
                        // Convert file path to data URL and copy
                        const imageResult = await window.electronAPI.getImageAsDataUrl(result.imagePath);
                        if (imageResult.success) {
                            await window.electronAPI.copyAsImage(imageResult.dataUrl);
                            showSuccess('Translated image copied to clipboard!');
                        } else {
                            showError('Failed to prepare image for copying');
                        }
                    } else {
                        showError('Failed to create translated image: ' + result.error);
                    }
                } else {
                    showError('Translated image cannot be created - missing data');
                }
                break;
                
            default:
                showError('Unknown copy type');
        }
    } catch (error) {
        console.error('Copy failed:', error);
        showError('Copy operation failed: ' + error.message);
    }
}

async function retranslateCurrentResult() {
    if (!currentResultData || !currentResultData.imagePath || !currentResultData.textBlocks) {
        showToast('Not enough data to re-translate.', 'error');
        return;
    }

    const newTargetLanguage = document.getElementById('targetLanguageSelect').value;
    showLoading(true);

    try {
        const result = await window.electronAPI.createTranslatedImage({
            originalImagePath: currentResultData.imagePath,
            originalText: currentResultData.originalText,
            textBlocks: currentResultData.textBlocks,
            targetLanguage: newTargetLanguage
        });

        if (result.success) {
            // Update currentResultData with the new translated info
            currentResultData.translatedImagePath = result.imagePath;
            currentResultData.translatedText = result.translatedText;
            currentResultData.targetLanguage = newTargetLanguage;
            
            // Re-render the result view with the new data
            showTranslationResult(currentResultData);
            // Update the history with the new result
            addToHistory(currentResultData);

            showToast(`Retranslated to ${getLanguageName(newTargetLanguage)}`, 'success');
        } else {
            showError('Failed to re-translate image: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        showError('Error during re-translation: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function addToHistory(translation) {
    const existingIndex = translationHistory.findIndex(item => item.imagePath === translation.imagePath);

    const newEntry = { ...translation, id: `hist-${Date.now()}`, timestamp: new Date().toISOString() };

    if (existingIndex > -1) {
        // Update the existing entry to avoid duplicates but keep its original ID
        newEntry.id = translationHistory[existingIndex].id;
        translationHistory[existingIndex] = newEntry;
    } else {
        translationHistory.unshift(newEntry);
    }

    if (translationHistory.length > 50) {
        translationHistory.pop();
    }
    localStorage.setItem('translationHistory', JSON.stringify(translationHistory));
    loadHistory();
} 