// Application state
let currentTranslation = null;
let translationHistory = JSON.parse(localStorage.getItem('translationHistory') || '[]');
let availableLanguages = [];
let isCapturing = false;
let captureCanvas = null;
let captureContext = null;
let screenshotImage = null;
let selectionStart = null;
let isSelecting = false;
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
            const section = e.target.getAttribute('data-section');
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
            showToast('Feature under development', 'info');
        });
    }

    // Settings form
    const settingsForm = document.getElementById('settingsForm');
    if (settingsForm) {
        settingsForm.addEventListener('submit', saveSettings);
    }

    // Listen for capture completion
    window.electronAPI.onCaptureComplete((result) => {
        handleCaptureComplete(result);
    });
}

// Navigation between sections
function showSection(sectionName) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Remove active class from all nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Show target section
    document.getElementById(sectionName).classList.add('active');
    
    // Add active class to corresponding nav item
    document.querySelector(`[data-section="${sectionName}"]`).classList.add('active');
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

// Setup capture overlay
function setupCaptureOverlay() {
    // Create overlay container
    const overlay = document.createElement('div');
    overlay.id = 'capture-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.6);
        z-index: 10000;
        cursor: crosshair;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        backdrop-filter: blur(2px);
    `;

    // Create instructions
    const instructions = document.createElement('div');
    instructions.style.cssText = `
        position: absolute;
        top: 30px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 15px 25px;
        border-radius: 10px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 16px;
        z-index: 10001;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(255, 255, 255, 0.1);
    `;
    instructions.innerHTML = '🔍 <strong>Click and drag</strong> to select an area to capture • Press <strong>ESC</strong> to cancel';

    // Create canvas for screenshot and selection
    captureCanvas = document.createElement('canvas');
    captureContext = captureCanvas.getContext('2d');
    
    // Size canvas to fit window while maintaining aspect ratio
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const imageAspect = screenshotImage.width / screenshotImage.height;
    const windowAspect = windowWidth / windowHeight;
    
    let canvasWidth, canvasHeight;
    if (imageAspect > windowAspect) {
        canvasWidth = windowWidth * 0.95;
        canvasHeight = canvasWidth / imageAspect;
    } else {
        canvasHeight = (windowHeight - 120) * 0.95; // Account for instructions
        canvasWidth = canvasHeight * imageAspect;
    }
    
    captureCanvas.width = canvasWidth;
    captureCanvas.height = canvasHeight;
    captureCanvas.style.cssText = `
        border: 3px solid #007AFF;
        border-radius: 12px;
        cursor: crosshair;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        background: #000;
    `;
    
    // Draw screenshot on canvas
    captureContext.drawImage(screenshotImage, 0, 0, canvasWidth, canvasHeight);
    
    // Add event listeners
    captureCanvas.addEventListener('mousedown', startSelection);
    captureCanvas.addEventListener('mousemove', updateSelection);
    captureCanvas.addEventListener('mouseup', endSelection);
    captureCanvas.addEventListener('mouseleave', () => {
        if (isSelecting) {
            isSelecting = false;
            // Redraw clean screenshot
            captureContext.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
            captureContext.drawImage(screenshotImage, 0, 0, canvasWidth, canvasHeight);
        }
    });
    
    // Add keyboard listener for ESC
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            cancelCapture();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Add elements to overlay
    overlay.appendChild(instructions);
    overlay.appendChild(captureCanvas);
    document.body.appendChild(overlay);
}

// Selection handling with improved visual feedback
function startSelection(e) {
    isSelecting = true;
    const rect = captureCanvas.getBoundingClientRect();
    selectionStart = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
    
    // Change cursor to indicate selection started
    captureCanvas.style.cursor = 'crosshair';
}

function updateSelection(e) {
    if (!isSelecting) return;
    
    const rect = captureCanvas.getBoundingClientRect();
    const currentPos = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
    
    // Redraw screenshot
    captureContext.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
    captureContext.drawImage(screenshotImage, 0, 0, captureCanvas.width, captureCanvas.height);
    
    // Calculate selection rectangle
    const x = Math.min(selectionStart.x, currentPos.x);
    const y = Math.min(selectionStart.y, currentPos.y);
    const width = Math.abs(currentPos.x - selectionStart.x);
    const height = Math.abs(currentPos.y - selectionStart.y);
    
    // Draw darkened overlay everywhere except selection
    captureContext.fillStyle = 'rgba(0, 0, 0, 0.5)';
    captureContext.fillRect(0, 0, captureCanvas.width, captureCanvas.height);
    
    // Clear the selected area (show original image)
    captureContext.clearRect(x, y, width, height);
    captureContext.drawImage(screenshotImage, x, y, width, height, x, y, width, height);
    
    // Draw selection border with animated effect
    captureContext.strokeStyle = '#007AFF';
    captureContext.lineWidth = 3;
    captureContext.setLineDash([8, 4]);
    captureContext.lineDashOffset = Date.now() * 0.01; // Animated dashes
    captureContext.strokeRect(x, y, width, height);
    
    // Add corner handles for resize indication
    const handleSize = 8;
    captureContext.fillStyle = '#007AFF';
    captureContext.setLineDash([]);
    
    // Corner handles
    captureContext.fillRect(x - handleSize/2, y - handleSize/2, handleSize, handleSize);
    captureContext.fillRect(x + width - handleSize/2, y - handleSize/2, handleSize, handleSize);
    captureContext.fillRect(x - handleSize/2, y + height - handleSize/2, handleSize, handleSize);
    captureContext.fillRect(x + width - handleSize/2, y + height - handleSize/2, handleSize, handleSize);
    
    // Show selection dimensions
    if (width > 50 && height > 20) {
        const dimensionText = `${Math.round(width)} × ${Math.round(height)}`;
        captureContext.fillStyle = 'rgba(0, 0, 0, 0.8)';
        captureContext.fillRect(x, y - 25, dimensionText.length * 8 + 10, 20);
        captureContext.fillStyle = '#ffffff';
        captureContext.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
        captureContext.fillText(dimensionText, x + 5, y - 10);
    }
}

async function endSelection(e) {
    if (!isSelecting) return;
    
    isSelecting = false;
    const rect = captureCanvas.getBoundingClientRect();
    const selectionEnd = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
    
    // Calculate selection bounds (in original screenshot coordinates)
    const scaleX = screenshotImage.width / captureCanvas.width;
    const scaleY = screenshotImage.height / captureCanvas.height;
    
    const bounds = {
        x: Math.min(selectionStart.x, selectionEnd.x) * scaleX,
        y: Math.min(selectionStart.y, selectionEnd.y) * scaleY,
        width: Math.abs(selectionEnd.x - selectionStart.x) * scaleX,
        height: Math.abs(selectionEnd.y - selectionStart.y) * scaleY
    };
    
    // Remove overlay
    const overlay = document.getElementById('capture-overlay');
    if (overlay) {
        overlay.remove();
    }
    
    isCapturing = false;
    
    // Process the captured area
    if (bounds.width > 10 && bounds.height > 10) {
        await processCapture(bounds);
    }
}

function cancelCapture() {
    const overlay = document.getElementById('capture-overlay');
    if (overlay) {
        overlay.remove();
    }
    isCapturing = false;
    isSelecting = false;
}

// Process captured area
async function processCapture(bounds) {
    try {
        showLoading(true);
        
        // Capture the selected area
        const captureResult = await window.electronAPI.captureArea(bounds);
        
        if (!captureResult.success) {
            showError('Failed to capture area: ' + captureResult.error);
            return;
        }
        
        // The intelligent language detection and translation is now handled in main.js
        // We'll get the result via the capture completion handler
        
    } catch (error) {
        showError('Error processing capture: ' + error.message);
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
    
    if (translationHistory.length === 0) {
        historyList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-history"></i>
                <h3>No translations yet</h3>
                <p>Start capturing and translating to see your history here</p>
            </div>
        `;
        return;
    }
    
    historyList.innerHTML = translationHistory.map(item => `
        <div class="history-item">
            <div class="history-date">${new Date(item.timestamp).toLocaleDateString()}</div>
            <div class="history-text">
                <div class="original">${item.originalText.substring(0, 100)}${item.originalText.length > 100 ? '...' : ''}</div>
                <div class="translated">${item.translatedText.substring(0, 100)}${item.translatedText.length > 100 ? '...' : ''}</div>
            </div>
        </div>
    `).join('');
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
    toast.className = `toast-notification toast-${type}`;
    
    // Set icon based on type
    let icon = '';
    switch (type) {
        case 'success':
            icon = '<i class="fas fa-check-circle"></i>';
            break;
        case 'error':
            icon = '<i class="fas fa-exclamation-circle"></i>';
            break;
        case 'info':
        default:
            icon = '<i class="fas fa-info-circle"></i>';
            break;
    }
    
    toast.innerHTML = `
        ${icon}
        <span>${message}</span>
    `;
    
    // Add styles
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? '#EF4444' : type === 'success' ? '#10B981' : '#6366F1'};
        color: white;
        padding: 16px 20px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        gap: 12px;
        font-weight: 500;
        font-size: 14px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
    `;
    
    // Add to document
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
    }, 100);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
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
        const detectedLang = result.detectedLanguage || 'unknown';
        const targetLang = result.targetLanguage || 'ja';
        
        console.log(`Language detected: ${detectedLang}, translated to: ${targetLang}`);
        console.log('Text blocks found:', result.textBlocks ? result.textBlocks.length : 0);
        
        currentTranslation = {
            id: Date.now(),
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