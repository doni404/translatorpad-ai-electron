// Application state
let currentTranslation = null;
let translationHistory = JSON.parse(localStorage.getItem('translationHistory') || '[]');
let availableLanguages = [];
let googleCloudConfigured = false;

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    await loadSupportedLanguages();
    await checkGoogleCloudStatus();
    loadHistory();
    setupEventListeners();
    showSection('home');
});

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
        const targetLang = getLanguageName(item.language || 'unknown');
        
        return `
            <div class="history-item" data-index="${index}">
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
    document.getElementById('originalText').textContent = translation.originalText;
    document.getElementById('translatedText').textContent = translation.translatedText;
    
    // Show language detection info if available
    const modalHeader = document.querySelector('.modal-header h2');
    if (translation.detectedLanguage && translation.language) {
        const detectedName = getLanguageName(translation.detectedLanguage);
        const targetName = getLanguageName(translation.language);
        modalHeader.textContent = `Translation Results (${detectedName} → ${targetName})`;
    } else {
        modalHeader.textContent = 'Translation Results';
    }
    
    // Populate and set the target language dropdown
    const targetLanguageSelect = document.getElementById('targetLanguageSelect');
    if (targetLanguageSelect && availableLanguages.length > 0) {
        // Clear existing options
        targetLanguageSelect.innerHTML = '';
        
        // Sort languages with common ones first
        const commonLanguages = ['ja', 'en', 'es', 'fr', 'de', 'ko', 'zh'];
        const sortedLanguages = [...availableLanguages].sort((a, b) => {
            const aIndex = commonLanguages.indexOf(a.code);
            const bIndex = commonLanguages.indexOf(b.code);
            
            // If both are common languages, sort by their position in commonLanguages
            if (aIndex !== -1 && bIndex !== -1) {
                return aIndex - bIndex;
            }
            // If only a is common, put it first
            if (aIndex !== -1) return -1;
            // If only b is common, put it first
            if (bIndex !== -1) return 1;
            // If neither is common, sort alphabetically
            return a.name.localeCompare(b.name);
        });
        
        // Add all available languages
        sortedLanguages.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang.code;
            option.textContent = lang.name;
            
            // Set as selected if it matches the current target language
            if (lang.code === translation.language) {
                option.selected = true;
            }
            
            targetLanguageSelect.appendChild(option);
        });
    }
    
    document.getElementById('resultsModal').classList.add('active');
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
    console.log('Capture completed:', result);
    
    if (result.success) {
        // --- FIX: Prevent Duplicate History ---
        // Check if an entry with this exact ID already exists.
        const existingEntry = translationHistory.find(item => item.id === result.id);
        if (existingEntry) {
            console.log('Duplicate history item detected. Ignoring.');
            // Still show the result, just don't add another history item.
            showTranslationResult(existingEntry);
            return;
        }

        const detectedLang = result.detectedLanguage || 'unknown';
        const targetLang = result.targetLanguage || 'ja';
        
        console.log(`Language detected: ${detectedLang}, translated to: ${targetLang}`);
        console.log('Text blocks found:', result.textBlocks ? result.textBlocks.length : 0);
        
        currentTranslation = {
            id: result.id, // Use the ID from the main process
            originalText: result.originalText,
            translatedText: result.translatedText,
            timestamp: new Date().toISOString(),
            imagePath: result.imagePath,
            language: targetLang,
            detectedLanguage: detectedLang,
            textBlocks: result.textBlocks || []
        };
        
        // Add to history
        translationHistory.unshift(currentTranslation);
        if (translationHistory.length > 50) {
            translationHistory = translationHistory.slice(0, 50);
        }
        localStorage.setItem('translationHistory', JSON.stringify(translationHistory));
        
        // Show results
        showTranslationResult(currentTranslation);
        loadHistory();
    } else {
        showError('Capture failed: ' + result.error);
    }
}

// Modal controls
function closeModal() {
    document.getElementById('resultsModal').classList.remove('active');
}

// Add event listeners after DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Modal close button
    const closeModalBtn = document.getElementById('closeModal');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeModal);
    }

    // Save buttons
    const saveTextBtn = document.getElementById('saveTextBtn');
    if (saveTextBtn) {
        saveTextBtn.addEventListener('click', async () => {
            if (currentTranslation) {
                const content = `Original Text:\n${currentTranslation.originalText}\n\nTranslated Text:\n${currentTranslation.translatedText}`;
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
            if (currentTranslation) {
                try {
                    showLoading(true);
                    
                    // Create image with translated text overlay in exact positions
                    const translatedImageResult = await window.electronAPI.createTranslatedImage({
                        originalImagePath: currentTranslation.imagePath,
                        originalText: currentTranslation.originalText,
                        translatedText: currentTranslation.translatedText,
                        textBlocks: currentTranslation.textBlocks || []
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

    // Retranslate button
    const retranslateBtn = document.getElementById('retranslateBtn');
    if (retranslateBtn) {
        retranslateBtn.addEventListener('click', async () => {
            if (currentTranslation) {
                const targetLanguageSelect = document.getElementById('targetLanguageSelect');
                const newTargetLanguage = targetLanguageSelect.value;
                
                if (!newTargetLanguage) {
                    showError('Please select a target language');
                    return;
                }
                
                try {
                    showLoading(true);
                    
                    // Re-translate with new language
                    const result = await window.electronAPI.extractAndTranslate({
                        imagePath: currentTranslation.imagePath,
                        targetLanguage: newTargetLanguage
                    });
                    
                    if (result.success) {
                        // Update current translation
                        currentTranslation.translatedText = result.translatedText;
                        currentTranslation.language = newTargetLanguage;
                        
                        // Update the display
                        document.getElementById('translatedText').textContent = result.translatedText;
                        
                        // Update the modal title with new language direction
                        const modalHeader = document.querySelector('.modal-header h2');
                        if (modalHeader && currentTranslation.detectedLanguage) {
                            const detectedName = getLanguageName(currentTranslation.detectedLanguage);
                            const targetName = getLanguageName(newTargetLanguage);
                            modalHeader.textContent = `Translation Results (${detectedName} → ${targetName})`;
                        }
                        
                        // Update history
                        const historyIndex = translationHistory.findIndex(item => item.id === currentTranslation.id);
                        if (historyIndex >= 0) {
                            translationHistory[historyIndex] = currentTranslation;
                            localStorage.setItem('translationHistory', JSON.stringify(translationHistory));
                        }
                        
                        showSuccess('Text retranslated successfully!');
                    } else {
                        showError('Failed to retranslate: ' + result.error);
                    }
                } catch (error) {
                    showError('Error during retranslation: ' + error.message);
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

    // API setup link (legacy)
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
});

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