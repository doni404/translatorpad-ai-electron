const { app, BrowserWindow, ipcMain, globalShortcut, screen, desktopCapturer, dialog, systemPreferences, Menu, clipboard, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { VisionService } = require('./services/visionService');
const { TranslationService } = require('./services/translationService');
const { ScreenshotService } = require('./services/screenshotService');
const { StoreService } = require('./services/storeService');

class App {
  constructor() {
    this.mainWindow = null;
    this.captureWindow = null;
    this.miniGalleryWindow = null; // New persistent gallery window
    this.visionService = new VisionService();
    this.translationService = new TranslationService();
    this.storeService = new StoreService();
    this.screenshotService = new ScreenshotService(this.translationService);
    this.hasUsedCaptureSuccessfully = false;
    this.globalShortcutInProgress = false; // Prevent duplicate shortcut calls
    this.lastShortcutTime = 0; // Add cooldown tracking
    this.lastLupResult = null; // Store the last lup result for the "Open in App" feature
    this.targetLanguage = this.storeService.getTargetLanguage(); // Load from store
    this.captureGallery = []; // Store recent captures (max 5)
    this.maxGalleryItems = 5; // Limit gallery to 5 items
    this.shortcutsRecordingActive = false; // Flag to prevent shortcuts during recording
    
    this.init();
  }

  init() {
    app.whenReady().then(() => {
      this.createMainWindow();
      this.registerShortcuts();
      this.setupIpcHandlers();
      // Don't check permissions on startup - only when actually needed
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createMainWindow();
      }
    });
  }

  createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      title: 'TransPad AI',
      titleBarStyle: 'default',
      movable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        preload: path.join(__dirname, 'preload.js')
      },
      icon: path.join(__dirname, '../../assets/icons/transpad_512x512.png')
    });

    this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Create and set the application menu
    this.createMenu();

    // Only open dev tools if explicitly requested
    const isDev = process.argv.includes('--dev');
    if (isDev && process.argv.includes('--debug')) {
      this.mainWindow.webContents.openDevTools();
    }

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    // Set the application's dock icon
    const iconPath = path.join(__dirname, '../../assets/icons/transpad_512x512.png');
    if (process.platform === 'darwin') {
      app.dock.setIcon(iconPath);
    }
  }

  createMenu() {
    const shortcuts = this.storeService.getShortcuts();
    
    const template = [
      {
        label: 'TransPad AI',
        submenu: [
          {
            label: 'About TransPad AI',
            click: () => {
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('show-about-page');
              }
            }
          },
          { type: 'separator' },
          {
            label: 'Hide TransPad AI',
            accelerator: 'Command+H',
            role: 'hide'
          },
          {
            label: 'Hide Others',
            accelerator: 'Command+Alt+H',
            role: 'hideothers'
          },
          {
            label: 'Show All',
            role: 'unhide'
          },
          { type: 'separator' },
          {
            label: 'Quit',
            accelerator: 'Command+Q',
            click: () => {
              app.quit();
            }
          }
        ]
      },
      {
        label: 'File',
        submenu: [
          {
            label: 'Open Image...',
            accelerator: 'CommandOrControl+O',
            click: async () => {
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                await this.openImageFile();
              }
            }
          }
        ]
      },
      {
        label: 'Translation',
        submenu: [
          {
            label: 'Capture && Translate',
            accelerator: shortcuts['capture-translate'],
            click: () => {
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('trigger-capture');
              }
            }
          },
          {
            label: 'Translate && Paste Clipboard',
            accelerator: shortcuts['translate-paste'],
            click: async () => {
              await this.translateAndReplaceClipboard();
            }
          },
          {
            label: 'Copy Last Translation',
            accelerator: shortcuts['copy-last-translation'],
            click: () => {
              if (this.lastLupResult && this.lastLupResult.translatedText) {
                clipboard.writeText(this.lastLupResult.translatedText);
                
                // Show a confirmation notification
                if (Notification.isSupported()) {
                  new Notification({
                    title: 'Translation Copied',
                    body: 'The last translated text has been copied to your clipboard.',
                    silent: true
                  }).show();
                }
              }
            }
          },
          { type: 'separator' },
          {
            label: 'Target Language',
            submenu: [
              {
                label: '🇯🇵 Any → Japanese',
                accelerator: 'CommandOrControl+1',
                type: 'radio',
                checked: this.targetLanguage === 'ja',
                click: () => {
                  this.setTargetLanguage('ja');
                }
              },
              {
                label: '🇺🇸 Any → English',
                accelerator: 'CommandOrControl+2',
                type: 'radio',
                checked: this.targetLanguage === 'en',
                click: () => {
                  this.setTargetLanguage('en');
                }
              },
              {
                label: '🇮🇩 Any → Indonesian',
                accelerator: 'CommandOrControl+3',
                type: 'radio',
                checked: this.targetLanguage === 'id',
                click: () => {
                  this.setTargetLanguage('id');
                }
              }
            ]
          }
        ]
      },
      {
        label: 'History',
        submenu: [
          {
            label: 'Clear History',
            accelerator: 'CommandOrControl+Shift+Backspace',
            click: () => {
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('clear-history');
              }
            }
          }
        ]
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Reload',
            accelerator: 'CommandOrControl+R',
            click: (item, focusedWindow) => {
              if (focusedWindow) {
                focusedWindow.reload();
              }
            }
          },
          {
            label: 'Toggle Developer Tools',
            accelerator: 'F12',
            click: (item, focusedWindow) => {
              if (focusedWindow) {
                focusedWindow.webContents.toggleDevTools();
              }
            }
          },
          { type: 'separator' },
          {
            label: 'Minimize',
            accelerator: 'CommandOrControl+M',
            role: 'minimize'
          },
          {
            label: 'Close',
            accelerator: 'CommandOrControl+W',
            role: 'close'
          }
        ]
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Check for Updates...',
            click: () => {
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('show-toast', {
                  message: 'You are using the latest version of TransPad AI.',
                  type: 'success'
                });
              }
            }
          }
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  setTargetLanguage(language) {
    this.targetLanguage = language;
    console.log(`Target language set to: ${language}`);
    
    // Save to store
    this.storeService.setTargetLanguage(language);
    
    // Update the menu to reflect the new selection
    this.createMenu();
    
    // Notify renderer process and any open capture windows
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('target-language-changed', language);
    }
    
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      this.captureWindow.webContents.send('target-language-changed', language);
    }
  }

  createCaptureOverlay() {
    // ABSOLUTE PREVENTION: If overlay already exists, do not create another
    if (this.captureWindow) {
      console.log('❌ Capture overlay (Lup) already exists, preventing duplicate');
      return;
    }
    
    // Create the movable, resizable "Lup" window
    this.captureWindow = new BrowserWindow({
      width: 500,
      height: 400,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true, // Allow user to resize the lup
      movable: true,   // Allow user to move it
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    this.captureWindow.center();

    const lupHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            body {
                background-color: transparent;
                margin: 0;
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                overflow: hidden;
                cursor: grab; /* Change cursor to indicate movement */
            }
            html {
                overflow: hidden;
            }
            #container {
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                box-sizing: border-box;
                border-radius: 12px;
                -webkit-app-region: drag; /* The entire window is draggable again */
                cursor: grab; /* Change cursor to indicate movement */
                
                /* Visual style */
                background: rgba(180, 180, 180, 0.2);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.75);
                box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.85), 0 8px 35px rgba(0,0,0,0.3);
                
                display: flex;
                justify-content: center;
                align-items: center;
                flex-direction: column; /* Center content vertically */
            }
            #drag-handle {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 40px; /* Height of the drag area */
                -webkit-app-region: drag; /* This part IS draggable */
                display: flex;
                align-items: center;
                justify-content: center;
                color: rgba(255,255,255,0.4);
                font-size: 13px;
                font-weight: 500;
            }
            #instruction-text {
                color: rgba(255, 255, 255, 0.8);
                font-size: 14px;
                font-weight: 600;
                text-shadow: 0 1px 3px rgba(0,0,0,0.4);
                -webkit-app-region: no-drag; /* Make text non-draggable */
            }
            #loading-container {
                display: none;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                color: rgba(255, 255, 255, 0.9);
                -webkit-app-region: no-drag;
            }
            .loading-spinner {
                width: 40px;
                height: 40px;
                border: 3px solid rgba(255, 255, 255, 0.3);
                border-top: 3px solid #ffffff;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-bottom: 15px;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .loading-text {
                font-size: 14px;
                font-weight: 600;
                text-shadow: 0 1px 3px rgba(0,0,0,0.4);
                text-align: center;
            }
            .loading-steps {
                margin-top: 8px;
                font-size: 12px;
                color: rgba(255, 255, 255, 0.7);
                text-align: center;
            }
            #result-container {
                 position: absolute;
                 top: 1px; left: 1px; right: 1px; bottom: 1px; /* Inset within border */
                 display: none; /* Hidden by default */
                 border-radius: 11px;
                 overflow: hidden;
            }
            #resultImage {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            #language-indicator {
                position: absolute;
                top: 10px;
                left: 10px;
                background: rgba(0,0,0,0.7);
                color: white;
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 600;
                -webkit-app-region: no-drag;
                z-index: 10;
            }
            #controls {
                position: absolute;
                bottom: 15px; /* Moved to bottom */
                right: 15px;
                display: flex;
                gap: 8px;
                -webkit-app-region: no-drag;
            }
            .btn {
                background: rgba(0,0,0,0.4); /* Default visible background */
                color: rgba(255, 255, 255, 0.8);
                border: 1px solid rgba(255,255,255,0.1);
                width: 32px;
                height: 32px;
                border-radius: 50%;
                font-size: 14px; /* Adjusted for icon consistency */
                cursor: pointer;
                display: flex;
                justify-content: center;
                align-items: center;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                transition: all 0.2s ease;
                position: relative; /* Needed for tooltip positioning */
            }
            .btn:hover {
                background: rgba(0,0,0,0.6);
                color: white;
                transform: scale(1.05);
            }
            .btn .tooltip {
                visibility: hidden;
                background-color: rgba(0,0,0,0.9);
                color: #fff;
                text-align: center;
                border-radius: 4px;
                padding: 4px 8px;
                position: absolute;
                z-index: 1;
                bottom: calc(100% + 5px); /* Position 5px above button */
                left: 50%;
                transform: translateX(-50%); /* Modern centering */
                opacity: 0;
                transition: opacity 0.2s;
                font-size: 11px;
                font-weight: 600;
                white-space: nowrap; /* Prevent wrapping */
            }
            .btn:hover .tooltip {
                visibility: visible;
                opacity: 1;
            }
            .tooltip.tooltip-bottom {
                bottom: auto;
                top: calc(100% + 5px);
            }
            #closeBtn {
                position: absolute;
                top: 12px;
                right: 12px;
                -webkit-app-region: no-drag;
            }
            
            /* Copy dropdown positioned outside the Lup */
            #copyDropdown {
                position: absolute;
                bottom: 55px; /* Repositioned based on new controls */
                right: 15px;
                background: rgba(0,0,0,0.85);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 12px;
                min-width: 180px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                display: none;
                flex-direction: column;
                z-index: 1000;
                -webkit-app-region: no-drag;
                max-height: 95px; /* Force scrollbar on small windows */
                overflow-y: auto; /* Allow scrolling if needed */
            }
            
            #copyDropdown::-webkit-scrollbar {
                width: 6px;
            }
            #copyDropdown::-webkit-scrollbar-track {
                background: transparent;
            }
            #copyDropdown::-webkit-scrollbar-thumb {
                background-color: rgba(255,255,255,0.3);
                border-radius: 6px;
            }
            
            .copy-option {
                padding: 8px 12px;
                color: white;
                font-size: 12px; /* Smaller font */
                font-weight: 500;
                cursor: pointer;
                transition: background 0.2s ease;
                display: flex;
                align-items: center;
                gap: 8px;
                border: none;
                background: transparent;
                text-align: left;
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                white-space: nowrap;
            }
            
            .copy-option:hover {
                background: rgba(255,255,255,0.15);
            }
            
            .copy-option:not(:last-child) {
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
        </style>
    </head>
    <body>
        <div id="container">
            <div id="language-indicator">Any → English</div>
            <div id="instruction-text">Press Enter to Capture & Translate</div>
            <div id="loading-container">
                <div class="loading-spinner"></div>
                <div class="loading-text">Processing your capture...</div>
                <div class="loading-steps">Extracting text and translating</div>
            </div>
            <div id="result-container">
                 <img id="resultImage" />
            </div>
        </div>

        <!-- Controls are separate now -->
        <div id="controls">
            <button id="clearBtn" class="btn" style="display: none;"><i class="fas fa-sync-alt"></i><span class="tooltip">Clear</span></button>
            <button id="copyBtn" class="btn" style="display: none;"><i class="fas fa-copy"></i><span class="tooltip">Copy</span></button>
            <button id="openInAppBtn" class="btn" style="display: none;"><i class="fas fa-arrow-up-right-from-square"></i><span class="tooltip">Go App</span></button>
        </div>
        <button id="closeBtn" class="btn"><i class="fas fa-times"></i><span class="tooltip tooltip-bottom">Close</span></button>
        
        <!-- Copy dropdown positioned outside the Lup frame -->
        <div id="copyDropdown">
            <button class="copy-option" id="copyOriginalImage">📸 Copy Original Image</button>
            <button class="copy-option" id="copyTranslatedImage">🖼️ Copy Translated Image</button>
            <button class="copy-option" id="copyOriginalText">📄 Copy Original Text</button>
            <button class="copy-option" id="copyTranslatedText">📝 Copy Translated Text</button>
        </div>

        <script>
            const container = document.getElementById('container');
            const clearBtn = document.getElementById('clearBtn');
            const closeBtn = document.getElementById('closeBtn');
            const openInAppBtn = document.getElementById('openInAppBtn');
            const copyBtn = document.getElementById('copyBtn');
            const copyDropdown = document.getElementById('copyDropdown');
            const copyOriginalImage = document.getElementById('copyOriginalImage');
            const copyTranslatedImage = document.getElementById('copyTranslatedImage');
            const copyOriginalText = document.getElementById('copyOriginalText');
            const copyTranslatedText = document.getElementById('copyTranslatedText');
            const resultContainer = document.getElementById('result-container');
            const resultImage = document.getElementById('resultImage');
            const languageIndicator = document.getElementById('language-indicator');
            const instructionText = document.getElementById('instruction-text');
            const loadingContainer = document.getElementById('loading-container');

            // Store the current result data for copying
            let currentResult = null;

            // Language display mapping
            const languageLabels = {
                'ja': 'Any → Japanese',
                'en': 'Any → English',
                'id': 'Any → Indonesian'
            };

            // Function to show loading state
            function showLoading() {
                instructionText.style.display = 'none';
                loadingContainer.style.display = 'flex';
                resultContainer.style.display = 'none';
            }

            // Function to hide loading state
            function hideLoading() {
                loadingContainer.style.display = 'none';
            }

            // Update language indicator when target language changes
            window.electronAPI.onTargetLanguageChanged((language) => {
                languageIndicator.textContent = languageLabels[language] || 'Any → English';
            });

            document.addEventListener('keydown', (e) => {
                // Check for Enter key and that we are not already showing a result or loading
                if (e.key === 'Enter' && resultContainer.style.display !== 'block' && loadingContainer.style.display !== 'flex') {
                    showLoading(); // Show loading immediately
                    window.electronAPI.captureLupArea();
                }

                // Also listen for ESC to close
                if (e.key === 'Escape') {
                    window.electronAPI.closeCaptureOverlay();
                }
            });

            closeBtn.addEventListener('click', () => {
                window.electronAPI.closeCaptureOverlay();
            });

            clearBtn.addEventListener('click', () => {
                resultContainer.style.display = 'none'; // Hide image
                instructionText.style.display = 'block'; // Show instructions again
                hideLoading(); // Make sure loading is hidden
                clearBtn.style.display = 'none'; // Hide self
                copyBtn.style.display = 'none'; // Hide copy button
                openInAppBtn.style.display = 'none'; // Hide open in app button
                copyDropdown.style.display = 'none'; // Hide dropdown
                currentResult = null; // Clear result data
            });

            openInAppBtn.addEventListener('click', () => {
                window.electronAPI.openInApp();
            });

            // Copy button dropdown functionality
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (currentResult) {
                    const isVisible = copyDropdown.style.display === 'flex';
                    copyDropdown.style.display = isVisible ? 'none' : 'flex';
                }
            });

            // Copy original image
            copyOriginalImage.addEventListener('click', async (e) => {
                e.stopPropagation();
                copyDropdown.style.display = 'none';
                
                if (currentResult && currentResult.originalImageDataUrl) {
                    try {
                        await window.electronAPI.copyAsImage(currentResult.originalImageDataUrl);
                        showCopyFeedback(true, '📸');
                    } catch (error) {
                        console.error('Failed to copy original image:', error);
                        showCopyFeedback(false, '📸');
                    }
                }
            });

            // Copy translated image
            copyTranslatedImage.addEventListener('click', async (e) => {
                e.stopPropagation();
                copyDropdown.style.display = 'none';
                
                if (currentResult && currentResult.translatedImageDataUrl) {
                    try {
                        await window.electronAPI.copyAsImage(currentResult.translatedImageDataUrl);
                        showCopyFeedback(true, '🖼️');
                    } catch (error) {
                        console.error('Failed to copy translated image:', error);
                        showCopyFeedback(false, '🖼️');
                    }
                }
            });

            // Copy original text
            copyOriginalText.addEventListener('click', async (e) => {
                e.stopPropagation();
                copyDropdown.style.display = 'none';
                
                if (currentResult && currentResult.originalText) {
                    try {
                        await window.electronAPI.copyAsText(currentResult.originalText);
                        showCopyFeedback(true, '📄');
                    } catch (error) {
                        console.error('Failed to copy original text:', error);
                        showCopyFeedback(false, '📄');
                    }
                }
            });

            // Copy translated text
            copyTranslatedText.addEventListener('click', async (e) => {
                e.stopPropagation();
                copyDropdown.style.display = 'none';
                
                if (currentResult && currentResult.translatedText) {
                    try {
                        await window.electronAPI.copyAsText(currentResult.translatedText);
                        showCopyFeedback(true, '📝');
                    } catch (error) {
                        console.error('Failed to copy translated text:', error);
                        showCopyFeedback(false, '📝');
                    }
                }
            });

            // Helper function for copy feedback
            function showCopyFeedback(success, icon) {
                if (success) {
                    copyBtn.style.background = 'rgba(34, 197, 94, 0.7)';
                    copyBtn.innerHTML = '<i class="fas fa-check"></i>';
                } else {
                    copyBtn.style.background = 'rgba(239, 68, 68, 0.7)';
                    copyBtn.innerHTML = '<i class="fas fa-times"></i>';
                }
                
                setTimeout(() => {
                    copyBtn.style.background = 'rgba(0,0,0,0.4)';
                    copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
                }, 1500);
            }

            // Close dropdown when clicking elsewhere
            document.addEventListener('click', () => {
                copyDropdown.style.display = 'none';
            });

            // Listen for the translated image from main process
            window.electronAPI.onLupResult((imageDataUrl) => {
                hideLoading(); // Hide loading first
                resultImage.src = imageDataUrl;
                resultContainer.style.display = 'block';
                instructionText.style.display = 'none'; // Hide instructions on result
                clearBtn.style.display = 'flex'; // Show clear button
                copyBtn.style.display = 'flex'; // Show copy button
                openInAppBtn.style.display = 'flex'; // Show open in app button
                
                // Store the translated image data for copying
                if (currentResult) {
                    currentResult.translatedImageDataUrl = imageDataUrl;
                } else {
                    currentResult = { translatedImageDataUrl: imageDataUrl };
                }
            });

            // Listen for result data updates (we'll need this for text copying)
            window.electronAPI.onLupResultData((resultData) => {
                if (currentResult) {
                    currentResult.translatedText = resultData.translatedText;
                    currentResult.originalText = resultData.originalText;
                    currentResult.detectedLanguage = resultData.detectedLanguage;
                    currentResult.targetLanguage = resultData.targetLanguage;
                }
            });

            // Listen for original image data
            window.electronAPI.onOriginalImageData((originalImageDataUrl) => {
                if (currentResult) {
                    currentResult.originalImageDataUrl = originalImageDataUrl;
                }
            });

            // Listen for loading step updates
            window.electronAPI.onUpdateLoadingStep((stepText) => {
                const loadingStepsElement = document.querySelector('.loading-steps');
                if (loadingStepsElement) {
                    loadingStepsElement.textContent = stepText;
                }
            });

            // ESC key to cancel (handled in the main keydown listener now)
        </script>
    </body>
    </html>`;

    this.captureWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(lupHtml));

    // Ensure window is focused and on top
    this.captureWindow.once('ready-to-show', () => {
      this.captureWindow.show();
      this.captureWindow.focus();
      this.captureWindow.setAlwaysOnTop(true, 'screen-saver');
      
      // Send current target language to the capture window
      this.captureWindow.webContents.send('target-language-changed', this.targetLanguage);
    });

    // Handle window close
    this.captureWindow.on('closed', () => {
      this.captureWindow = null;
      // Reset global shortcut flag when overlay is closed/cancelled
      this.globalShortcutInProgress = false;
      console.log('Capture overlay closed, flag reset');
    });
  }

  createMiniGallery() {
    if (this.miniGalleryWindow) {
      console.log('Mini gallery already exists');
      return;
    }

    // Get screen dimensions for positioning
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { height: screenHeight } = primaryDisplay.workArea;

    // Gallery dimensions - START SMALL, will be resized dynamically
    const galleryWidth = 170; // Width for one item + padding
    const galleryHeight = 50; // A small initial height

    this.miniGalleryWindow = new BrowserWindow({
      width: galleryWidth,
      height: galleryHeight,
      x: 15, // Add margin from left edge
      y: screenHeight - galleryHeight, // Start position, will be adjusted
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false, // Remove shadow
      focusable: false, // Don't steal focus
      show: false, // Start hidden
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: false // Allow content to extend outside bounds
      }
    });

    const galleryHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            body {
                background-color: transparent;
                margin: 0;
                padding: 0;
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                overflow: hidden; /* Remove scroll capability */
                pointer-events: none; /* Make body and all empty areas click-through */
            }
            
            .gallery-container {
                display: flex;
                flex-direction: column-reverse;
                justify-content: flex-start; /* Items will start from the bottom */
                gap: 10px;
                /* Let the height be determined by content */
                width: 100%;
                padding: 12px;
                box-sizing: border-box;
                pointer-events: auto; /* Allow hover events on the container and its children */
            }
            
            .gallery-item {
                position: relative;
                width: 140px; /* Fixed width */
                height: 110px; /* Fixed height */
                border-radius: 8px;
                overflow: visible; /* CRITICAL: Allow buttons and tooltips to be visible */
                cursor: pointer;
                transition: transform 0.2s ease;
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(8px);
                border: 1px solid rgba(255, 255, 255, 0.2);
                opacity: 0;
                transform: translateY(20px);
                animation: slideInUp 0.4s ease-out forwards;
                flex-shrink: 0; /* Prevent items from shrinking */
            }
            
            .gallery-item:hover {
                transform: scale(1.05);
                border-color: rgba(255, 255, 255, 0.4);
            }
            
            .gallery-item.entering {
                animation: slideInUp 0.4s ease-out forwards;
            }
            
            .gallery-item.exiting {
                animation: slideOutDown 0.4s ease-out forwards;
            }
            
            @keyframes slideInUp {
                from {
                    transform: translateY(20px);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            
            @keyframes slideOutDown {
                from {
                    transform: translateY(0) scale(1);
                    opacity: 1;
                }
                to {
                    transform: translateY(20px) scale(0.8);
                    opacity: 0;
                }
            }
            
            .gallery-image {
                width: 100%;
                height: 100%;
                object-fit: cover; /* This is key for fitting any aspect ratio */
                border-radius: 7px;
            }
            
            .gallery-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.6);
                display: flex; /* Use flex for layout but hide with opacity */
                flex-direction: column;
                justify-content: center;
                align-items: center;
                gap: 5px;
                border-radius: 7px;
                overflow: visible; /* CRITICAL: Allow buttons and tooltips to be visible */
                /* Transition properties for a smooth fade */
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
            }
            
            .gallery-item:hover .gallery-overlay {
                opacity: 1;
                visibility: visible;
            }
            
            .gallery-actions-row {
                display: flex;
                gap: 5px;
            }
            
            .gallery-btn {
                position: relative; /* For tooltip positioning */
                background: rgba(0,0,0,0.5);
                color: rgba(255, 255, 255, 0.9);
                border: 1px solid rgba(255,255,255,0.1);
                width: 28px;
                height: 28px;
                border-radius: 50%;
                font-size: 12px;
                cursor: pointer;
                display: flex;
                justify-content: center;
                align-items: center;
                box-shadow: 0 1px 4px rgba(0,0,0,0.25);
                transition: all 0.2s ease;
            }
            
            .gallery-btn:hover {
                background: rgba(0,0,0,0.7);
                color: white;
                transform: scale(1.1);
                z-index: 20; /* Ensure tooltip appears on top */
            }
            
            .gallery-btn .tooltip {
                visibility: hidden;
                background-color: rgba(0,0,0,0.95);
                color: #fff;
                text-align: center;
                border-radius: 4px;
                padding: 3px 6px;
                position: absolute;
                z-index: 100;
                left: 50%;
                transform: translateX(-50%);
                opacity: 0;
                transition: opacity 0.2s, visibility 0.2s;
                font-size: 10px;
                font-weight: 500;
                white-space: nowrap;
                pointer-events: none; /* Prevent tooltip from interfering with mouse */
            }
            
            /* Default position: above the button */
            .gallery-btn .tooltip {
                bottom: 100%;
                margin-bottom: 5px;
            }

            /* Modifier for tooltips below the button */
            .gallery-btn .tooltip.tooltip-bottom {
                top: 100%;
                bottom: auto;
                margin-bottom: 0;
                margin-top: 5px;
            }

            .gallery-btn:hover .tooltip {
                visibility: visible;
                opacity: 1;
            }
            
            .gallery-item.empty {
                display: none;
            }
            
            .close-btn {
                position: absolute;
                top: 4px;
                right: 4px;
                background: rgba(0,0,0,0.4);
                color: rgba(255, 255, 255, 0.8);
                border: 1px solid rgba(255,255,255,0.1);
                width: 20px;
                height: 20px;
                border-radius: 50%;
                font-size: 10px;
                cursor: pointer;
                display: flex; /* Use flex for layout but hide with opacity */
                align-items: center;
                justify-content: center;
                box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                transition: all 0.2s ease;
                z-index: 10;
                /* Transition properties for a smooth fade */
                opacity: 0;
                visibility: hidden;
            }
            
            .gallery-item:hover .close-btn {
                opacity: 1;
                visibility: visible;
            }
            
            .close-btn:hover {
                background: rgba(0,0,0,0.6);
                color: white;
                transform: scale(1.1);
            }
        </style>
    </head>
    <body>
        <div class="gallery-container" id="galleryContainer">
            <!-- Gallery items will be inserted here -->
        </div>

        <script>
            let captureData = [];
            let activeDropdown = null;
            let removingIndex = -1;

            // Listen for new captures
            window.electronAPI.onGalleryUpdate && window.electronAPI.onGalleryUpdate((newCaptureData) => {
                captureData = newCaptureData;
                updateGallery();
            });

            function updateGallery() {
                const container = document.getElementById('galleryContainer');
                
                // If we're not in the middle of a removal animation, clear and rebuild
                if (removingIndex === -1) {
                    container.innerHTML = '';
                    
                    captureData.forEach((capture, index) => {
                        const item = createGalleryItem(capture, index);
                        item.classList.add('entering');
                        container.appendChild(item);
                    });
                    
                    // After rendering, calculate the required window height and send it to main
                    setTimeout(() => {
                        const requiredHeight = container.scrollHeight;
                        window.electronAPI.resizeGalleryWindow({ height: requiredHeight });
                    }, 50);
                }
            }

            function createGalleryItem(capture, index) {
                const item = document.createElement('div');
                item.className = 'gallery-item';
                item.setAttribute('data-index', index);
                item.innerHTML = \`
                    <img class="gallery-image" src="\${capture.originalImageDataUrl}" alt="Capture \${index + 1}" />
                    <button class="close-btn" onclick="removeItem(\${index}, event)" title="Remove"><i class="fas fa-times"></i></button>
                    <div class="gallery-overlay">
                        <div class="gallery-actions-row">
                             <button class="gallery-btn" onclick="copyItem(\${index}, 'originalImage')"><i class="fas fa-camera"></i><span class="tooltip tooltip-bottom">Original Img</span></button>
                             <button class="gallery-btn" onclick="copyItem(\${index}, 'translatedImage')"><i class="fas fa-image"></i><span class="tooltip tooltip-bottom">Translated Img</span></button>
                        </div>
                        <div class="gallery-actions-row">
                             <button class="gallery-btn" onclick="copyItem(\${index}, 'originalText')"><i class="fas fa-file-alt"></i><span class="tooltip">Original Txt</span></button>
                             <button class="gallery-btn" onclick="copyItem(\${index}, 'translatedText')"><i class="fas fa-language"></i><span class="tooltip">Translated Txt</span></button>
                        </div>
                    </div>
                \`;
                return item;
            }

            async function copyItem(index, type) {
                const capture = captureData[index];
                if (!capture) return;
                
                // Find the button that was clicked to give feedback
                const itemElement = document.querySelector(\`.gallery-item[data-index='\${index}']\`);
                let clickedButton;

                // This is a bit verbose but necessary to map type to the button
                switch(type) {
                    case 'originalImage': clickedButton = itemElement.querySelector('.fa-camera').parentElement; break;
                    case 'translatedImage': clickedButton = itemElement.querySelector('.fa-image').parentElement; break;
                    case 'originalText': clickedButton = itemElement.querySelector('.fa-file-alt').parentElement; break;
                    case 'translatedText': clickedButton = itemElement.querySelector('.fa-language').parentElement; break;
                }

                try {
                    let success = false;
                    switch (type) {
                        case 'originalImage':
                            if (capture.originalImageDataUrl) {
                                await window.electronAPI.copyAsImage(capture.originalImageDataUrl);
                                success = true;
                            }
                            break;
                        case 'originalText':
                            if (capture.originalText) {
                                await window.electronAPI.copyAsText(capture.originalText);
                                success = true;
                            }
                            break;
                        case 'translatedImage':
                            if (capture.translatedImageDataUrl) {
                                await window.electronAPI.copyAsImage(capture.translatedImageDataUrl);
                                success = true;
                            }
                            break;
                        case 'translatedText':
                            if (capture.translatedText) {
                                await window.electronAPI.copyAsText(capture.translatedText);
                                success = true;
                            }
                            break;
                    }
                    
                    if (clickedButton && success) {
                        showCopyFeedback(clickedButton, true);
                    } else if (clickedButton) {
                        showCopyFeedback(clickedButton, false);
                    }

                } catch (error) {
                    console.error('Copy failed:', error);
                    if (clickedButton) {
                        showCopyFeedback(clickedButton, false);
                    }
                }
            }
            
            function showCopyFeedback(button, success) {
                const originalIcon = button.innerHTML;
                if (success) {
                    button.innerHTML = '<i class="fas fa-check"></i>';
                    button.style.background = 'rgba(34, 197, 94, 0.7)';
                } else {
                    button.innerHTML = '<i class="fas fa-times"></i>';
                    button.style.background = 'rgba(239, 68, 68, 0.7)';
                }
                
                setTimeout(() => {
                    button.innerHTML = originalIcon;
                    button.style.background = 'rgba(0,0,0,0.5)';
                }, 1500);
            }

            function removeItem(index, event) {
                event.stopPropagation();
                removingIndex = index;
                
                const container = document.getElementById('galleryContainer');
                const allItems = Array.from(container.children);
                const itemToRemove = allItems.find(item => parseInt(item.getAttribute('data-index')) === index);
                
                if (itemToRemove) {
                    itemToRemove.classList.add('exiting');
                    
                    // Wait for animation, then just tell the main process to remove it.
                    // The main process will send back a 'gallery-update' which will trigger a re-render.
                    setTimeout(() => {
                        window.electronAPI.removeFromGallery(index);
                        removingIndex = -1; // Reset the animation lock
                    }, 400);
                }
            }

            // Close dropdowns when clicking elsewhere
            document.addEventListener('click', (e) => {
                if (activeDropdown && !activeDropdown.contains(e.target)) {
                    activeDropdown.classList.remove('show');
                    activeDropdown.style.display = 'none';
                    activeDropdown = null;
                }
            });
            
            // Prevent dropdown from closing when clicking inside it
            document.addEventListener('click', (e) => {
                if (e.target.closest('.copy-dropdown')) {
                    e.stopPropagation();
                }
            });
        </script>
    </body>
    </html>`;

    this.miniGalleryWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(galleryHtml));

    this.miniGalleryWindow.once('ready-to-show', () => {
      // Don't show automatically - let updateGalleryDisplay control visibility
      console.log('Mini gallery window ready but staying hidden until screenshots are added');
    });

    this.miniGalleryWindow.on('closed', () => {
      this.miniGalleryWindow = null;
    });

    console.log('Mini gallery window created (hidden)');
  }

  addCaptureToGallery(captureData, translationResult) {
    if (!captureData || !captureData.success) {
      return;
    }

    console.log('Adding capture to mini gallery');

    // Prepare gallery item data
    const galleryItem = {
      id: captureData.id,
      originalText: captureData.originalText,
      translatedText: captureData.translatedText,
      originalImageDataUrl: null, // Will be set below
      translatedImageDataUrl: null, // Will be set below
      detectedLanguage: captureData.detectedLanguage,
      targetLanguage: captureData.targetLanguage,
      timestamp: Date.now()
    };

    // Convert image files to data URLs
    try {
      // Original image
      if (captureData.imagePath && fs.existsSync(captureData.imagePath)) {
        const originalImageBuffer = fs.readFileSync(captureData.imagePath);
        galleryItem.originalImageDataUrl = `data:image/png;base64,${originalImageBuffer.toString('base64')}`;
      }

      // Translated image - use translation result if available, otherwise use original
      if (translationResult && translationResult.translatedImagePath && fs.existsSync(translationResult.translatedImagePath)) {
        const translatedImageBuffer = fs.readFileSync(translationResult.translatedImagePath);
        galleryItem.translatedImageDataUrl = `data:image/png;base64,${translatedImageBuffer.toString('base64')}`;
      } else {
        // Fallback to original image
        galleryItem.translatedImageDataUrl = galleryItem.originalImageDataUrl;
      }
      
    } catch (error) {
      console.error('Error processing gallery image:', error);
      return;
    }

    // Add to the beginning of the array (newest first)
    this.captureGallery.unshift(galleryItem);

    // Limit to maxGalleryItems
    if (this.captureGallery.length > this.maxGalleryItems) {
      this.captureGallery = this.captureGallery.slice(0, this.maxGalleryItems);
    }

    // Create gallery window if it doesn't exist
    if (!this.miniGalleryWindow) {
      this.createMiniGallery();
      // IMPORTANT: Wait for the gallery to be fully ready before sending the first update
      this.miniGalleryWindow.once('ready-to-show', () => {
        this.updateGalleryDisplay();
      });
    } else {
        // If it already exists, update it right away
        this.updateGalleryDisplay();
    }
  }

  updateGalleryDisplay() {
    if (this.miniGalleryWindow && !this.miniGalleryWindow.isDestroyed()) {
      if (this.captureGallery.length > 0) {
        // Show window and send gallery data
        if (!this.miniGalleryWindow.isVisible()) {
          this.miniGalleryWindow.show();
        }
        // Let the renderer calculate its own size, just send the data
        this.miniGalleryWindow.webContents.send('gallery-update', this.captureGallery);
      } else {
        // Hide window when no screenshots
        if (this.miniGalleryWindow.isVisible()) {
          this.miniGalleryWindow.hide();
        }
      }
    }
  }

  registerShortcuts() {
    // Unregister all shortcuts before registering new ones to prevent conflicts
    globalShortcut.unregisterAll();
    
    const shortcuts = this.storeService.getShortcuts();
    
    // Register capture & translate shortcut
    try {
      if (shortcuts['capture-translate'] && shortcuts['capture-translate'].trim()) {
        globalShortcut.register(shortcuts['capture-translate'], async () => {
          // Prevent execution if shortcuts are being recorded
          if (this.shortcutsRecordingActive) {
            console.log('Shortcuts recording active, ignoring global shortcut');
            return;
          }
          
          const now = Date.now();
          
          // COOLDOWN: Prevent rapid successive shortcut presses (2 second minimum)
          if (now - this.lastShortcutTime < 2000) {
            console.log('Global shortcut on cooldown, ignoring');
            return;
          }
          
          // CRITICAL: Prevent duplicate shortcut executions
          if (this.globalShortcutInProgress) {
            console.log('Global shortcut in progress, ignoring');
            return;
          }
          
          // ADDITIONAL PROTECTION: Check if capture window already exists
          if (this.captureWindow) {
            console.log('Capture window exists, ignoring shortcut');
            return;
          }
          
          this.globalShortcutInProgress = true;
          this.lastShortcutTime = now;
          console.log('Global shortcut activated');
          
          console.log('Global shortcut pressed - starting smart capture sequence...');
          
          try {
            // Check permissions silently first
            const hasPermission = await this.checkScreenPermissions(false);
            if (!hasPermission) {
              console.log('Screen recording permission needed, showing permission dialog...');
              // Now show the dialog since permission is actually needed
              const dialogResult = await this.checkScreenPermissions(true);
              if (!dialogResult) {
                this.globalShortcutInProgress = false;
                this.lastShortcutTime = 0;
                return;
              }
              
              // If permission was "not-determined", we need to trigger the system dialog
              const initialStatus = systemPreferences.getMediaAccessStatus('screen');
              if (initialStatus === 'not-determined') {
                console.log('Triggering system permission dialog...');
                
                // Ensure main window is visible to show toast messages
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                  this.mainWindow.show();
                  this.mainWindow.focus();
                }
                
                // Take a quick screenshot to trigger the system permission dialog
                try {
                  await this.screenshotService.captureFullScreen();
                } catch (error) {
                  console.log('Screenshot attempt triggered permission dialog (expected)');
                }
                
                // Wait for user to grant permission
                const permissionGranted = await this.waitForScreenPermission();
                if (!permissionGranted) {
                  console.log('Permission denied via global shortcut');
                  // Keep main window visible on permission denial
                  if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.show();
                    this.mainWindow.focus();
                  }
                  this.globalShortcutInProgress = false;
                  this.lastShortcutTime = 0;
                  return;
                }
                
                // IMPORTANT: Permission was just granted, so we need to verify it's actually working
                // Wait a moment for the system to fully apply the permission
                console.log('Permission granted, verifying...');
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Double-check permission status
                const finalStatus = systemPreferences.getMediaAccessStatus('screen');
                if (finalStatus !== 'granted') {
                  console.log('Permission verification failed:', finalStatus);
                  // Keep main window visible on permission issue
                  if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.show();
                    this.mainWindow.focus();
                  }
                  this.globalShortcutInProgress = false;
                  this.lastShortcutTime = 0;
                  return;
                }
              }
            }
            
            console.log('Permission check passed, proceeding with capture...');
            
            // NEW STRATEGY: Use system APIs to properly handle window switching
            
            // Step 1: Get the current frontmost app before we interfere
            const frontmostApp = await this.getFrontmostApplication();
            console.log('Frontmost app detected:', frontmostApp);
            
            // Step 2: Hide TransPad AI completely (not just minimize)
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.hide();
            }
            
            // Step 3: If the frontmost app wasn't TransPad AI, try to restore it
            if (frontmostApp && frontmostApp !== 'TransPad AI' && frontmostApp !== 'Electron') {
              console.log(`Attempting to restore ${frontmostApp}...`);
              await this.restoreFrontmostApp(frontmostApp);
              
              // Wait for the app to redraw
              await new Promise(resolve => setTimeout(resolve, 500));
            } else {
              // If TransPad AI was frontmost, just wait for desktop
              console.log('TransPad AI was frontmost, waiting for desktop...');
              await new Promise(resolve => setTimeout(resolve, 300));
            }
            
            // Step 4: Take screenshot
            console.log('Taking screenshot of current state...');
            const preCapture = await this.screenshotService.captureFullScreenBackground();
            this.preCaptureScreenshot = preCapture;
            console.log('Pre-capture completed, creating overlay...');
            
            // Step 5: Show overlay for selection - with additional check
            if (!this.captureWindow) {
              await this.startScreenCaptureWithoutPreCapture();
            } else {
              console.log('❌ Capture window created during process, skipping overlay creation');
            }
            
            // Mark that we've used capture successfully (for future runs)
            this.hasUsedCaptureSuccessfully = true;
            
            // DO NOT reset flag here - wait for actual capture completion or cancellation
            
          } catch (error) {
            console.error('Error in smart capture sequence:', error);
            // On error, restore the main window
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.show();
              this.mainWindow.focus();
            }
            // Reset flag on error
            this.globalShortcutInProgress = false;
            this.lastShortcutTime = 0;
            console.log('Global shortcut error, flag reset');
          }
        });
      }
    } catch (error) {
      console.error('Error registering shortcuts:', error);
    }

    // Register global shortcut for clipboard translation
    try {
      if (shortcuts['translate-paste'] && shortcuts['translate-paste'].trim()) {
        globalShortcut.register(shortcuts['translate-paste'], async () => {
          // Prevent execution if shortcuts are being recorded
          if (this.shortcutsRecordingActive) {
            console.log('Shortcuts recording active, ignoring global shortcut');
            return;
          }
          
          console.log('Global "Translate & Paste Clipboard" shortcut activated.');
          await this.translateAndReplaceClipboard();
        });
      }
    } catch (error) {
      console.error('Error registering translate-paste shortcut:', error);
    }
  }

  setupIpcHandlers() {
    ipcMain.handle('start-capture', async () => {
      // This function is now simplified, as screenshot is taken on-demand
      try {
        // Check permissions silently first when called from UI
        const hasPermission = await this.checkScreenPermissions(false);
        if (!hasPermission) {
          console.log('Screen recording permission needed, showing permission dialog...');
          // Show the dialog since permission is actually needed
          const dialogResult = await this.checkScreenPermissions(true);
          if (!dialogResult) {
            return { success: false, error: 'Screen recording permission required' };
          }
          
          // If permission was "not-determined", we need to trigger the system dialog
          // by attempting a capture, then wait for user response
          const initialStatus = systemPreferences.getMediaAccessStatus('screen');
          if (initialStatus === 'not-determined') {
            console.log('Triggering system permission dialog...');
            
            // Ensure main window is visible to show toast messages
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.show();
              this.mainWindow.focus();
            }
            
            // Take a quick screenshot to trigger the system permission dialog
            try {
              await this.screenshotService.captureFullScreen();
            } catch (error) {
              console.log('Screenshot attempt triggered permission dialog (expected)');
            }
            
            // Wait for user to grant permission
            const permissionGranted = await this.waitForScreenPermission();
            if (!permissionGranted) {
              // Keep main window visible on permission denial
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.show();
                this.mainWindow.focus();
              }
              return { success: false, error: 'Screen recording permission was denied' };
            }
            
            // IMPORTANT: Permission was just granted, so we need to verify it's actually working
            // Wait a moment for the system to fully apply the permission
            console.log('Permission granted, verifying...');
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Double-check permission status
            const finalStatus = systemPreferences.getMediaAccessStatus('screen');
            if (finalStatus !== 'granted') {
              console.log('Permission verification failed:', finalStatus);
              return { success: false, error: 'Screen recording permission was not properly granted. Please restart the app.' };
            }
          }
        }

        console.log('UI capture button pressed - using smart capture strategy...');

        // Hide main window and show the lup. No pre-capture needed here.
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.hide();
        }
        await new Promise(resolve => setTimeout(resolve, 300)); // Wait for hide animation
        this.createCaptureOverlay();

        return { success: true };
      } catch (error) {
        console.error('Error starting screen capture:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('capture-lup-area', async () => {
      try {
        if (!this.captureWindow) {
          throw new Error('Capture window is not available.');
        }

        const bounds = this.captureWindow.getBounds();
        console.log('Lup capture initiated with bounds:', bounds);

        // --- New Approach: Keep window visible but make it transparent for screenshot ---
        // First, store the current window properties
        const originalOpacity = this.captureWindow.getOpacity();
        
        // Update loading text - step 1
        if (this.captureWindow && !this.captureWindow.isDestroyed()) {
          this.captureWindow.webContents.send('update-loading-step', 'Capturing screenshot...');
        }
        
        // Make the window transparent for screenshot but keep it visible to user
        this.captureWindow.setOpacity(0.01); // Almost transparent but still visible to OS
        
        // Small delay to ensure transparency is applied
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get the screenshot with transparent window
        const screenshot = await this.screenshotService.captureFullScreenBackground();
        
        // Immediately restore window opacity so user sees loading state
        this.captureWindow.setOpacity(originalOpacity);
        
        // --- End Modified Section ---

        // Update loading text - step 2
        if (this.captureWindow && !this.captureWindow.isDestroyed()) {
          this.captureWindow.webContents.send('update-loading-step', 'Extracting text from image...');
        }

        const imagePath = await this.screenshotService.captureAreaFromExisting(
          bounds, 
          screenshot.filePath
        );
        
        const extractionResult = await this.visionService.extractText(imagePath);
        
        // Update loading text - step 3
        if (this.captureWindow && !this.captureWindow.isDestroyed()) {
          this.captureWindow.webContents.send('update-loading-step', 'Translating text...');
        }
        
        // Use the selected target language instead of auto-detection
        console.log(`Using selected target language: ${this.targetLanguage}`);
        const translationResult = await this.screenshotService.createImageWithTranslation(
          imagePath, 
          extractionResult.fullText, 
          extractionResult.textBlocks,
          this.targetLanguage  // Pass the selected target language
        );

        this.lastLupResult = {
          id: `cap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Unique ID
          success: true,
          originalText: extractionResult.fullText,
          translatedText: translationResult.fullTranslatedText,
          imagePath: imagePath,
          detectedLanguage: translationResult.detectedLanguage,
          targetLanguage: this.targetLanguage, // Use selected target language
          textBlocks: extractionResult.textBlocks
        };
        
        // --- CORRECTED LOGIC ---
        // 1. Send to history immediately after capture.
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          console.log('Sending capture result to main window for history.');
          this.mainWindow.webContents.send('capture-complete', this.lastLupResult);
        }

        // 2. Add to mini gallery
        this.addCaptureToGallery(this.lastLupResult, translationResult);

        // 3. Send image to Lup window to be displayed.
        if (this.captureWindow && !this.captureWindow.isDestroyed()) {
          const imageBuffer = fs.readFileSync(translationResult.translatedImagePath);
          const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;
          this.captureWindow.webContents.send('lup-result', dataUrl);
          
          // Also send the original image data for copying
          const originalImageBuffer = fs.readFileSync(imagePath);
          const originalDataUrl = `data:image/png;base64,${originalImageBuffer.toString('base64')}`;
          this.captureWindow.webContents.send('original-image-data', originalDataUrl);
          
          // Also send the result data for text copying
          this.captureWindow.webContents.send('lup-result-data', {
            originalText: extractionResult.fullText,
            translatedText: translationResult.fullTranslatedText,
            detectedLanguage: translationResult.detectedLanguage,
            targetLanguage: this.targetLanguage
          });
        }

        this.globalShortcutInProgress = false;
        this.lastShortcutTime = 0;
        console.log('Lup capture process completed.');

        return { success: true };

      } catch (error) {
        console.error('Error during lup capture process:', error);
        
        // Ensure window opacity is restored even if there's an error
        if (this.captureWindow && !this.captureWindow.isDestroyed()) {
          this.captureWindow.setOpacity(1.0);
        }
        
        if (this.captureWindow) {
          this.captureWindow.close();
        }
        this.globalShortcutInProgress = false;
        this.lastShortcutTime = 0;
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('open-in-app', () => {
      // --- CORRECTED LOGIC ---
      // This button's only job is to show the main window. History is already logged.
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        console.log('Bringing main window to front and showing last result.');
        this.mainWindow.show();
        this.mainWindow.focus();

        // Also send the last result to be displayed in the modal
        if (this.lastLupResult) {
            this.mainWindow.webContents.send('capture-complete', this.lastLupResult);
        }
        
        if (this.captureWindow) {
          this.captureWindow.close();
        }
      } else {
        console.warn('Could not open in app: Main window is not available.');
      }
    });

    ipcMain.handle('close-capture-overlay', () => {
      if (this.captureWindow) {
        this.captureWindow.close();
        this.captureWindow = null;
      }
      // Restore the main window when the lup is closed
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.show();
        this.mainWindow.focus();
        // Tell the renderer to go back to the home screen
        this.mainWindow.webContents.send('reset-to-home');
      }
      this.globalShortcutInProgress = false;
      console.log('Capture overlay closed, flag reset');
    });

    ipcMain.handle('capture-area', async (event, bounds) => {
      return await this.captureSelectedArea(bounds);
    });

    ipcMain.handle('extract-and-translate', async (event, { imagePath, targetLanguage }) => {
      try {
        const extractionResult = await this.visionService.extractText(imagePath);
        const extractedText = extractionResult.fullText;
        const translatedText = await this.translationService.translateText(extractedText, targetLanguage);
        
        return {
          originalText: extractedText,
          translatedText: translatedText,
          textBlocks: extractionResult.textBlocks,
          success: true
        };
      } catch (error) {
        console.error('Error in extract-and-translate:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    ipcMain.handle('get-languages', async () => {
      return this.translationService.getSupportedLanguages();
    });

    ipcMain.on('open-external-link', (event, url) => {
      const { shell } = require('electron');
      shell.openExternal(url);
    });

    ipcMain.handle('save-result', async (event, { type, data, filename }) => {
      try {
        const { filePath } = await dialog.showSaveDialog(this.mainWindow, {
          defaultPath: filename,
          filters: type === 'text' ? 
            [{ name: 'Text Files', extensions: ['txt'] }] :
            [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
        });

        if (filePath) {
          if (type === 'text') {
            fs.writeFileSync(filePath, data);
          } else {
            // For image data, copy the file
            fs.copyFileSync(data, filePath);
          }
          return { success: true, path: filePath };
        }
        return { success: false };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('create-translated-image', async (event, { originalImagePath, originalText, textBlocks, targetLanguage }) => {
      try {
        // The screenshot service now correctly uses the passed targetLanguage
        const result = await this.screenshotService.createImageWithTranslation(
          originalImagePath, 
          originalText, 
          textBlocks,
          targetLanguage
        );
        return { 
          success: true, 
          imagePath: result.translatedImagePath,
          translatedText: result.fullTranslatedText // <-- Return the new text
        };
      } catch (error) {
        console.error('Error creating translated image:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('get-screenshot', async () => {
      try {
        const screenshot = await this.screenshotService.captureFullScreen();
        return { success: true, screenshot };
      } catch (error) {
        console.error('Error getting screenshot:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('minimize-window', () => {
      if (this.mainWindow) {
        this.mainWindow.minimize();
      }
    });

    ipcMain.handle('restore-window', () => {
      if (this.mainWindow) {
        this.mainWindow.restore();
        this.mainWindow.focus();
      }
    });

    // Clipboard operations
    ipcMain.handle('copy-as-image', async (event, imageDataUrl) => {
      try {
        // Convert data URL to native image
        const image = nativeImage.createFromDataURL(imageDataUrl);
        clipboard.writeImage(image);
        console.log('Image copied to clipboard successfully');
        return { success: true };
      } catch (error) {
        console.error('Error copying image to clipboard:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('copy-as-text', async (event, text) => {
      try {
        clipboard.writeText(text);
        console.log('Text copied to clipboard successfully');
        return { success: true };
      } catch (error) {
        console.error('Error copying text to clipboard:', error);
        return { success: false, error: error.message };
      }
    });

    // History copy operations
    ipcMain.handle('get-original-image-for-copy', async (event, imagePath) => {
      try {
        if (!imagePath || !fs.existsSync(imagePath)) {
          return { success: false, error: 'Image file not found' };
        }
        
        const imageBuffer = fs.readFileSync(imagePath);
        const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;
        
        return { success: true, imageDataUrl: dataUrl };
      } catch (error) {
        console.error('Error loading original image for copy:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('get-image-as-data-url', async (event, imagePath) => {
      try {
        if (!imagePath || !fs.existsSync(imagePath)) {
          return { success: false, error: 'Image file not found' };
        }
        
        const imageBuffer = fs.readFileSync(imagePath);
        const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;
        
        return { success: true, dataUrl: dataUrl };
      } catch (error) {
        console.error('Error converting image to data URL:', error);
        return { success: false, error: error.message };
      }
    });

    // Gallery operations
    ipcMain.handle('resize-gallery-window', (event, { height }) => {
        if (this.miniGalleryWindow && !this.miniGalleryWindow.isDestroyed()) {
            const { screen } = require('electron');
            const primaryDisplay = screen.getPrimaryDisplay();
            const { height: screenHeight } = primaryDisplay.workArea;
            
            const currentBounds = this.miniGalleryWindow.getBounds();
            const newHeight = Math.max(0, height); // Ensure height is not negative

            // Animate is smoother on macOS this way
            this.miniGalleryWindow.setBounds({
                x: currentBounds.x,
                y: screenHeight - newHeight, // Reposition based on new height
                width: currentBounds.width, // Width stays constant
                height: newHeight
            }, true); // Animate the change
        }
    });
    
    ipcMain.handle('remove-from-gallery', async (event, index) => {
      try {
        if (index >= 0 && index < this.captureGallery.length) {
          this.captureGallery.splice(index, 1);
          // After removing, send the updated gallery back to the renderer
          this.updateGalleryDisplay();
          console.log(`Removed gallery item at index ${index}, updated gallery sent.`);
        }
        return { success: true };
      } catch (error) {
        console.error('Error removing gallery item:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('show-clear-history-dialog', async () => {
      const iconPath = path.join(__dirname, '../../assets/icons/transpad_512x512.png');
      const image = nativeImage.createFromPath(iconPath);

      const result = await dialog.showMessageBox(this.mainWindow, {
        type: 'question',
        buttons: ['Yes', 'No'],
        defaultId: 1, // 'No' is the default option
        title: 'Confirm Clear History',
        message: 'Are you sure you want to clear all translation history?',
        detail: 'This action cannot be undone.',
        icon: image // Force the icon here
      });
      return result;
    });

    ipcMain.handle('get-app-version', () => {
      return app.getVersion();
    });

    // Shortcut Management
    ipcMain.handle('get-shortcuts', () => {
      return this.storeService.getShortcuts();
    });

    ipcMain.handle('set-shortcuts', (event, shortcuts) => {
      // Validate shortcuts before saving
      const validShortcuts = {};
      for (const [key, shortcut] of Object.entries(shortcuts)) {
        if (shortcut && typeof shortcut === 'string' && shortcut.trim().length > 0) {
          // Basic validation: must contain at least one letter/number after modifiers
          if (/[a-zA-Z0-9]/.test(shortcut)) {
            validShortcuts[key] = shortcut.trim();
          } else {
            console.warn(`Invalid shortcut for ${key}: ${shortcut}`);
          }
        }
      }
      
      this.storeService.setShortcuts(validShortcuts);
      this.registerShortcuts(); // Re-register with the new settings
      this.createMenu(); // Rebuild menu to show updated shortcuts
    });

    ipcMain.handle('reset-shortcuts', () => {
      const shortcuts = this.storeService.resetShortcuts();
      this.registerShortcuts();
      this.createMenu(); // Rebuild menu to show updated shortcuts
      return shortcuts;
    });

    // Language Management
    ipcMain.handle('get-target-language', () => {
      return this.storeService.getTargetLanguage();
    });

    ipcMain.handle('set-target-language', (event, language) => {
      this.setTargetLanguage(language);
    });

    // Shortcuts Recording Control
    ipcMain.handle('set-shortcuts-recording', (event, isRecording) => {
      this.shortcutsRecordingActive = isRecording;
      console.log(`Shortcuts recording ${isRecording ? 'activated' : 'deactivated'}`);
    });
  }

  async startScreenCaptureWithoutPreCapture() {
    try {
      // If capture window already exists, close it first
      if (this.captureWindow) {
        this.captureWindow.close();
        this.captureWindow = null;
      }

      // Don't take pre-capture here - it was already done in shortcut handler
      console.log('Using pre-captured screenshot, creating overlay...');
      
      // Don't minimize main window again - already done in shortcut handler
      
      // Small delay to ensure any existing window is fully closed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create the transparent overlay for global area selection
      this.createCaptureOverlay();
      
      return { success: true };
    } catch (error) {
      console.error('Error starting screen capture without pre-capture:', error);
      return { success: false, error: error.message };
    }
  }

  async captureSelectedArea(bounds) {
    try {
      // Close the capture overlay first
      if (this.captureWindow) {
        this.captureWindow.close();
        this.captureWindow = null;
      }

      // Use the pre-captured screenshot instead of taking a new one
      // This avoids timing issues with desktop refresh after overlay closes
      console.log('Using pre-captured screenshot for area extraction...');
      
      if (!this.preCaptureScreenshot) {
        throw new Error('No pre-capture screenshot available');
      }

      // Capture the selected area using the pre-captured screenshot
      console.log('Capturing area with bounds:', bounds);
      const imagePath = await this.screenshotService.captureAreaFromExisting(
        bounds, 
        this.preCaptureScreenshot.filePath
      );
      
      // Extract text first
      const extractionResult = await this.visionService.extractText(imagePath);
      const extractedText = extractionResult.fullText;
      const textBlocks = extractionResult.textBlocks;
      
      // Detect the language of the extracted text
      let targetLanguage = 'ja'; // Default to Japanese
      let detectedLanguage = { language: 'unknown', confidence: 0 }; // Initialize with default
      
      try {
        detectedLanguage = await this.translationService.detectLanguage(extractedText);
        console.log('Detected language:', detectedLanguage);
        
        // If detected language is Japanese, translate to English
        if (detectedLanguage.language === 'ja') {
          targetLanguage = 'en';
          console.log('Japanese text detected, translating to English');
        } else {
          // For all other languages, translate to Japanese
          targetLanguage = 'ja';
          console.log(`${detectedLanguage.language} text detected, translating to Japanese`);
        }
      } catch (error) {
        console.warn('Language detection failed, using default Japanese:', error.message);
        targetLanguage = 'ja';
        detectedLanguage = { language: 'unknown', confidence: 0 };
      }
      
      // Translate with the determined target language
      const translatedText = await this.translationService.translateText(extractedText, targetLanguage);
      
      // Clean up pre-capture screenshot
      this.preCaptureScreenshot = null;
      
      // Reset global shortcut flag when capture is fully complete
      this.globalShortcutInProgress = false;
      // Reset cooldown on successful completion to allow immediate next capture
      this.lastShortcutTime = 0;
      console.log('Capture completed successfully');
      
      // ONLY NOW restore and focus the main window to show results
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.restore();
        this.mainWindow.focus();
        
        this.mainWindow.webContents.send('capture-complete', {
          success: true,
          originalText: extractedText,
          translatedText: translatedText,
          imagePath: imagePath,
          detectedLanguage: detectedLanguage.language || 'unknown',
          targetLanguage: targetLanguage,
          textBlocks: textBlocks
        });
      }
      
      return { success: true, imagePath };
    } catch (error) {
      console.error('Error capturing selected area:', error);
      
      // Clean up pre-capture screenshot on error
      this.preCaptureScreenshot = null;
      
      // Reset global shortcut flag on error
      this.globalShortcutInProgress = false;
      // Reset cooldown on error to allow retry
      this.lastShortcutTime = 0;
      console.log('Capture error, flag reset');
      
      // Restore window even on error to show error message
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.restore();
        this.mainWindow.focus();
        
        this.mainWindow.webContents.send('capture-complete', {
          success: false,
          error: error.message
        });
      }
      
      return { success: false, error: error.message };
    }
  }

  async getFrontmostApplication() {
    try {
      const { exec } = require('child_process');
      return new Promise((resolve, reject) => {
        // Use AppleScript to get the frontmost application
        const script = `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`;
        
        exec(script, (error, stdout, stderr) => {
          if (error) {
            console.warn('Could not detect frontmost app:', error.message);
            resolve(null);
          } else {
            const appName = stdout.trim();
            resolve(appName);
          }
        });
      });
    } catch (error) {
      console.error('Error getting frontmost application:', error);
      return null;
    }
  }

  async restoreFrontmostApp(appName) {
    try {
      const { exec } = require('child_process');
      return new Promise((resolve) => {
        // Use AppleScript to activate the application
        const script = `osascript -e 'tell application "${appName}" to activate'`;
        
        exec(script, (error, stdout, stderr) => {
          if (error) {
            console.warn(`Could not restore app ${appName}:`, error.message);
          } else {
            console.log(`Successfully restored ${appName}`);
          }
          resolve(); // Always resolve to continue the flow
        });
      });
    } catch (error) {
      console.error('Error restoring frontmost app:', error);
    }
  }

  async waitForScreenPermission() {
    // Helper function to wait for permission to be actually granted
    console.log('Waiting for screen recording permission confirmation...');
    
    const maxAttempts = 15; // Wait up to 15 seconds (increased from 10)
    for (let i = 0; i < maxAttempts; i++) {
      const status = systemPreferences.getMediaAccessStatus('screen');
      console.log(`Permission check attempt ${i + 1}: ${status}`);
      
      if (status === 'granted') {
        console.log('✅ Screen recording permission confirmed');
        return true;
      }
      
      if (status === 'denied' || status === 'restricted') {
        console.log('❌ Screen recording permission denied');
        return false;
      }
      
      // Show helpful toast after 2 seconds if permission dialog might be blocked
      if (i === 1) {
        this.showPermissionToast('📋 macOS permission dialog is showing. Look for it and click "Allow"');
      }
      
      // Show warning toast after 5 seconds if still waiting
      if (i === 4) {
        this.showPermissionToast('⚠️ Still waiting for permission. The dialog may be hidden behind other windows or blocked by the overlay');
      }
      
      // Show urgent toast after 10 seconds
      if (i === 9) {
        this.showPermissionToast('❌ Permission dialog may be blocked. Try pressing ESC to cancel, then restart the app and try again');
      }
      
      // Wait 1 second before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('⏰ Timeout waiting for permission confirmation');
    this.showPermissionToast('❌ Permission timeout. The dialog may have been blocked. Please restart the app and try again.');
    return false;
  }

  showPermissionToast(message) {
    // Send toast message to renderer if main window exists
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('show-toast', {
        message: message,
        type: 'warning',
        duration: 4000
      });
    }
  }

  async checkScreenPermissions(showDialog = true) {
    try {
      if (process.platform === 'darwin') {
        console.log('Checking macOS screen recording permissions...');
        
        // Check if we have screen recording permission
        let hasPermission = systemPreferences.getMediaAccessStatus('screen');
        console.log('Screen recording permission status:', hasPermission);
        
        // Handle the "not-determined" case where macOS will show permission dialog
        if (hasPermission === 'not-determined') {
          console.log('Permission not determined - will trigger system dialog on capture attempt');
          
          if (showDialog) {
            const result = await dialog.showMessageBox(this.mainWindow, {
              type: 'info',
              title: 'Screen Recording Permission Required',
              message: 'TransPad AI needs screen recording permission to capture screenshots.',
              detail: 'When you proceed, macOS will show a permission dialog. Please click "Allow" to grant access.\n\nNote: The permission dialog may appear behind other windows - please look for it.',
              buttons: ['Proceed', 'Cancel'],
              defaultId: 0
            });
            
            if (result.response !== 0) {
              return false; // User cancelled
            }
            
            // User chose to proceed - return true to trigger the system dialog
            return true;
          }
          
          // For silent checks, return true as permission will be requested when needed
          return true;
        }
        
        if (hasPermission !== 'granted') {
          console.log('Screen recording permission not granted, status:', hasPermission);
          
          // Only show dialog if explicitly requested
          if (showDialog) {
            // For denied/restricted permissions, user must manually grant
            const result = await dialog.showMessageBox(this.mainWindow, {
              type: 'warning',
              title: 'Screen Recording Permission Required',
              message: 'TransPad AI needs screen recording permission to capture screenshots from other applications.',
              detail: 'Please grant permission in System Preferences > Security & Privacy > Privacy > Screen Recording, then restart the app.\n\nNote: You may need to restart TransPad AI after granting permission.',
              buttons: ['Open System Preferences', 'Cancel'],
              defaultId: 0
            });
            
            if (result.response === 0) {
              // Open System Preferences to Screen Recording section
              const { exec } = require('child_process');
              exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"');
            }
          }
          
          return false;
        }
        
        console.log('Screen recording permission granted ✅');
        return true;
      }
      
      // Non-macOS platforms don't need this permission
      return true;
    } catch (error) {
      console.error('Error checking screen permissions:', error);
      return false;
    }
  }

  async openImageFile() {
    try {
      const { filePaths } = await dialog.showOpenDialog(this.mainWindow, {
        title: 'Open Image for Translation',
        properties: ['openFile'],
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
        ]
      });

      if (!filePaths || filePaths.length === 0) {
        console.log('No file selected.');
        return;
      }

      const originalImagePath = filePaths[0];
      console.log(`Image opened: ${originalImagePath}`);
      console.log(`[File Open] Using target language from main process: ${this.targetLanguage}`);

      // 1. Ensure the temp directory exists
      const tempDir = path.join(app.getPath('userData'), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // 2. Copy the file to a temp location so we can treat it like a capture
      const imagePath = path.join(tempDir, `opened-${Date.now()}${path.extname(originalImagePath)}`);
      fs.copyFileSync(originalImagePath, imagePath);

      // 3. Extract text
      const extractionResult = await this.visionService.extractText(imagePath);
      if (!extractionResult.fullText || extractionResult.fullText.trim() === '') {
        this.mainWindow.webContents.send('show-toast', {
            message: 'No text found in the image.',
            type: 'warning'
        });
        return;
      }

      // 4. Translate and create the new image
      const translationResult = await this.screenshotService.createImageWithTranslation(
        imagePath,
        extractionResult.fullText,
        extractionResult.textBlocks,
        this.targetLanguage
      );

      // 5. Send result to renderer (same as capture)
      const result = {
        success: true,
        originalText: extractionResult.fullText,
        translatedText: translationResult.fullTranslatedText,
        imagePath: imagePath, // Path to the temp copy
        translatedImagePath: translationResult.translatedImagePath, // Path to the translated version
        detectedLanguage: translationResult.detectedLanguage,
        targetLanguage: this.targetLanguage,
        textBlocks: extractionResult.textBlocks
      };

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('capture-complete', result);
        // Also add it to the mini gallery
        // this.addCaptureToGallery(result, translationResult); // <-- REMOVED as per request
      }
      
      console.log('Image file processing complete.');

    } catch (error) {
      console.error('Error opening and processing image file:', error);
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('capture-complete', {
          success: false,
          error: `Failed to process image: ${error.message}`
        });
      }
    }
  }

  async translateAndReplaceClipboard() {
    try {
      const text = clipboard.readText();
      if (!text || text.trim() === '') {
        console.log('No text on clipboard to translate.');
        if (Notification.isSupported()) {
          new Notification({
            title: 'Clipboard Empty',
            body: 'There is no text on the clipboard to translate.',
            silent: true
          }).show();
        }
        return;
      }

      console.log(`Translating and pasting clipboard: "${text.substring(0, 30)}..."`);

      const translatedText = await this.translationService.translateText(text, this.targetLanguage);
      if (!translatedText) {
        throw new Error('Translation service failed to return a result.');
      }

      // Temporarily hide our app to focus the previous one
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.hide();
      }

      // Put the translated text on the clipboard
      clipboard.writeText(translatedText);
      
      // Give the OS a moment to switch focus
      await new Promise(resolve => setTimeout(resolve, 200));

      // Use AppleScript to simulate a paste command
      const { exec } = require('child_process');
      const script = `osascript -e 'tell application "System Events" to keystroke "v" using command down'`;
      exec(script, (error) => {
        if (error) {
          console.error('Failed to execute paste command:', error);
          // If pasting fails, at least the text is on the clipboard.
          // Show the window again so the user isn't confused.
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show();
          }
        } else {
          console.log('Paste command executed successfully.');
          // Optionally, briefly show and re-hide the window to show the notification,
          // or just let it stay hidden. For now, we'll keep it hidden.
        }
      });

      // Store this as the last result so it can be copied
      this.lastLupResult = {
        id: `text-replace-${Date.now()}`,
        success: true,
        originalText: text,
        translatedText: translatedText,
        imagePath: null,
        detectedLanguage: 'unknown',
        targetLanguage: this.targetLanguage,
        textBlocks: []
      };

      // Show a confirmation notification
      if (Notification.isSupported()) {
        const languageName = new Intl.DisplayNames(['en'], { type: 'language' }).of(this.targetLanguage) || this.targetLanguage;
        new Notification({
          title: `Translated to ${languageName} & Copied`,
          body: translatedText,
          silent: true
        }).show();
      }

      console.log(`Clipboard replacement successful.`);

    } catch (error) {
      console.error('Error translating and pasting clipboard:', error);
      if (Notification.isSupported()) {
        new Notification({
          title: 'Translation Failed',
          body: 'Could not translate the text from the clipboard.',
          silent: true
        }).show();
      }
    }
  }
}

new App();