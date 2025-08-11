const { app, BrowserWindow, ipcMain, globalShortcut, screen, dialog, systemPreferences, Menu, clipboard, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { VisionService } = require('./services/visionService');
const { TranslationService } = require('./services/translationService');
const { ScreenshotService } = require('./services/screenshotService');
const { StoreService } = require('./services/storeService');
const { OpenAIService } = require('./services/openaiService');

class App {
  constructor() {
    this.mainWindow = null;
    this.captureWindow = null;
    this.miniGalleryWindow = null; // New persistent gallery window
    this.imageViewerWindow = null; // For the singleton viewer window
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
    this.currentDragFilePath = null; // Track current drag temp file for cleanup
    this.accessibilityPermissionAsked = false; // Track if we've asked for accessibility permissions
    this.openAIService = new OpenAIService(this.storeService);
    
    this.init();
  }

  // Helper method to ensure proper main window and dock management
  ensureMainWindowVisible() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      console.log('🔧 Ensuring main window is properly visible and focused');
      
      // Ensure dock icon is visible on macOS
      if (process.platform === 'darwin') {
        app.dock.show();
      }
      
      // Restore window properly
      this.mainWindow.show();
      this.mainWindow.restore(); // In case it was minimized
      this.mainWindow.focus();
      this.mainWindow.moveTop(); // Bring to front
      
      // Temporarily set on top to ensure it comes to front, then reset
      this.mainWindow.setAlwaysOnTop(true);
      setTimeout(() => {
        this.mainWindow.setAlwaysOnTop(false);
      }, 100);
      
      console.log('✅ Main window visibility ensured');
      return true;
    }
    return false;
  }

  init() {
    app.whenReady().then(async () => {
      try {
        this.createMainWindow();
        this.setupIpcHandlers(); // Set up IPC handlers first
        this.registerShortcuts(); // Then register shortcuts
        console.log('✅ App initialization complete');
        // Don't check permissions on startup - only when actually needed
      } catch (error) {
        console.error('❌ Error during app initialization:', error);
      }
    });

    // Set a flag before quitting
    app.on('before-quit', () => {
      app.isQuitting = true;
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      console.log('🚀 App activate event triggered');
      if (BrowserWindow.getAllWindows().length === 0) {
        console.log('📱 No windows exist, creating main window');
        this.createMainWindow();
      } else {
        this.ensureMainWindowVisible();
        console.log('✅ Main window restored from dock');
      }
    });
  }

  createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
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

    this.mainWindow.on('close', (event) => {
      // On macOS, prevent quitting when the window is closed and hide it instead
      if (process.platform === 'darwin') {
        if (!app.isQuitting) {
          event.preventDefault();
          this.mainWindow.hide();
          // Ensure dock icon remains visible even when window is hidden
          app.dock.show();
          console.log('🏠 Main window hidden but dock icon kept visible');
        }
      }
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    // Set the application's dock icon
    const iconPath = path.join(__dirname, '../../assets/icons/transpad_512x512.png');
    if (process.platform === 'darwin') {
      app.dock.setIcon(iconPath);
      // Ensure dock is always visible when main window is created
      app.dock.show();
      console.log('🎨 Dock icon set and made visible');
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
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
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
            label: 'AI Translate && Paste Clipboard',
            accelerator: shortcuts['ai-translate-paste'],
            click: async () => {
              await this.aiImproveAndReplaceClipboard();
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

  createCaptureOverlay(cursorPosition = null) {
    // ABSOLUTE PREVENTION: If overlay already exists, do not create another
    if (this.captureWindow) {
      console.log('❌ Capture overlay (Lup) already exists, preventing duplicate');
      return;
    }
    
    const winOptions = {
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
    };

    if (cursorPosition) {
      winOptions.x = Math.round(cursorPosition.x - winOptions.width / 2);
      winOptions.y = Math.round(cursorPosition.y - winOptions.height / 2);
    }
    
    // Create the movable, resizable "Lup" window
    this.captureWindow = new BrowserWindow(winOptions);

    if (!cursorPosition) {
      this.captureWindow.center();
    }

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
                border-radius: 20px;
                -webkit-app-region: drag;
                cursor: grab;

                /* Inner Glow effect from sample */
                background: rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                /* animation: glow-inset 2.5s ease-in-out infinite; MOVED to ::before */

                display: flex;
                justify-content: center;
                align-items: center;
                flex-direction: column;
                transition: all 0.3s ease-in-out;
            }

            #top-left-controls {
                position: absolute;
                top: 10px;
                left: 10px;
                display: flex;
                align-items: center;
                gap: 8px;
                z-index: 100;
                -webkit-app-region: no-drag;
            }

            #view-switch {
                display: flex;
                background: rgba(0,0,0,0.4);
                border-radius: 12px;
                border: 1px solid rgba(255,255,255,0.1);
                -webkit-app-region: no-drag;
            }
            .view-btn {
                background: transparent;
                border: none;
                color: rgba(255,255,255,0.6);
                padding: 4px 8px;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 12px;
            }
            .view-btn:hover {
                color: white;
            }
            .view-btn.active {
                background: rgba(255,255,255,0.15);
                color: white;
                border-radius: 10px;
            }
            
            #container.result-shown {
                /* When any result is shown, make the glass pane transparent */
                background: transparent;
                backdrop-filter: none;
                border: none;
            }

            /* The glow layer */
            #container::before {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: 20px; /* Match container */
                animation: glow-inset 2.5s ease-in-out infinite;
                /* Bring the glow layer to the front for ALL results */
                z-index: -1; /* Behind the glass by default */
                pointer-events: none; /* Make it click-through */
                transition: z-index 0.1s step-end;
            }
            
            #container.result-shown::before {
                z-index: 10; /* Bring the glow in front of the result image (z-index 5) */
            }
            
            @keyframes glow-inset {
                0%, 100% {
                    box-shadow:
                        inset 0 5px 8px rgba(255, 89, 172, 0.6),   /* Top - Pink */
                        inset 0 -5px 8px rgba(162, 89, 255, 0.6),  /* Bottom - Purple */
                        inset 5px 0 8px rgba(255, 157, 89, 0.6),   /* Left - Orange */
                        inset -5px 0 8px rgba(0, 255, 255, 0.6);   /* Right - Cyan */
                }
                50% {
                    box-shadow:
                        inset 0 6px 12px rgba(162, 89, 255, 0.6),  /* Top - Purple */
                        inset 0 -6px 12px rgba(0, 255, 255, 0.6),   /* Bottom - Cyan */
                        inset 6px 0 12px rgba(255, 89, 172, 0.6),   /* Left - Pink */
                        inset -6px 0 12px rgba(255, 157, 89, 0.6);  /* Right - Orange */
                }
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
                color: rgba(255, 255, 255, 0.95);
                font-size: 12px;
                font-weight: 500;
                -webkit-app-region: no-drag;
                background-color: rgba(0, 0, 0, 0.5);
                padding: 5px 10px;
                border-radius: 14px;
                backdrop-filter: blur(5px);
                border: 1px solid rgba(255,255,255,0.1);
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
                border-radius: 50%;
                /* Softer, pastel-like gradient */
                background: conic-gradient(from 0deg, #ffc1e3, #d6bfff, #b3edff, #ffdfb3, #ffc1e3);
                /* Slower and smoother animation */
                animation: spin 1.8s linear infinite;
                margin-bottom: 15px;
                -webkit-mask: radial-gradient(farthest-side, #0000 calc(100% - 4px), #000 0);
                mask: radial-gradient(farthest-side, #0000 calc(100% - 4px), #000 0);
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .loading-text {
                font-size: 12px;
                font-weight: 500;
                text-align: center;
                background-color: rgba(0, 0, 0, 0.5);
                padding: 5px 10px;
                border-radius: 14px;
                backdrop-filter: blur(5px);
                border: 1px solid rgba(255,255,255,0.1);
                color: rgba(255, 255, 255, 0.95);
            }
            .loading-steps {
                margin-top: 8px;
                font-size: 12px;
                color: rgba(255, 255, 255, 0.85);
                text-align: center;
                background-color: rgba(0, 0, 0, 0.5);
                padding: 4px 10px;
                border-radius: 14px;
                backdrop-filter: blur(5px);
                border: 1px solid rgba(255,255,255,0.1);
            }
            #result-container {
                 position: absolute;
                 top: 1px; left: 1px; right: 1px; bottom: 1px; /* Inset within border */
                 display: none; /* Hidden by default */
                 border-radius: 18px; /* Fit inside the container's radius */
                 overflow: hidden;
                 z-index: 5; /* Sit below the glow overlay */
            }
            #container.result-shown #result-container {
                display: block;
            }
            #resultImage {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            #language-indicator {
                background: rgba(0,0,0,0.4); /* Match other buttons */
                color: rgba(255,255,255,0.8);
                padding: 2px 8px; /* Match view-btn */
                border-radius: 12px;
                font-size: 12px; /* Match view-btn */
                font-weight: 500;
                -webkit-app-region: no-drag;
                border: 1px solid rgba(255,255,255,0.1);
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            #language-indicator .flag {
                font-size: 14px;
            }
            #language-indicator:hover {
                background: rgba(0,0,0,0.6);
            }
            #controls {
                position: absolute;
                bottom: 15px; /* Moved to bottom */
                right: 15px;
                display: flex;
                gap: 8px;
                -webkit-app-region: no-drag;
                z-index: 100; /* Ensure controls are on top of the glow */
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
                background-color: rgba(0, 0, 0, 0.9);
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
                z-index: 100; /* Ensure close button is on top of the glow */
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
            #text-result-container {
                display: none;
                position: absolute;
                inset: 0; /* Let it fill the container */
                background: white;
                border-radius: 20px; /* Match container */
                overflow: hidden; /* Hide scrollbar overflow from container */
                z-index: 5; /* Sit below the glow overlay */
                box-sizing: border-box;
                padding: 0; /* Remove padding to allow textarea to fill it */
            }
            #text-result-container textarea {
                width: 100%;
                height: 100%;
                border: none;
                border-radius: 20px; /* Match container */
                padding: 15px; /* Add padding inside the text area */
                box-sizing: border-box;
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 14px;
                line-height: 1.6;
                background-color: white;
                resize: none;
                color: #222;
                -webkit-app-region: no-drag; /* CRITICAL: Make textarea interactive */
            }
            #text-result-container textarea:focus {
                outline: none;
            }
            #language-indicator:hover {
                background: rgba(0,0,0,0.6);
            }
            #language-dropdown {
                position: absolute;
                top: 50px; /* Position below the indicator */
                left: 10px;
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
            }
            .lang-option {
                padding: 8px 12px;
                color: white;
                font-size: 12px;
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
            .lang-option:hover {
                background: rgba(255,255,255,0.15);
            }
            .lang-option:not(:last-child) {
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            #controls {
                position: absolute;
                bottom: 15px; /* Moved to bottom */
                right: 15px;
                display: flex;
                gap: 8px;
                -webkit-app-region: no-drag;
                z-index: 100; /* Ensure controls are on top of the glow */
            }
        </style>
    </head>
    <body>
        <div id="container">
            <div id="top-left-controls">
                <div id="language-indicator" title="Change Language">
                    Any → <span class="flag">🇯🇵</span>
                </div>
                <div id="view-switch">
                    <button id="image-view-btn" class="view-btn active" title="Show Image"><i class="fas fa-image"></i></button>
                    <button id="text-view-btn" class="view-btn" title="Show Text"><i class="fas fa-align-left"></i></button>
                </div>
            </div>
            <div id="instruction-text">Press Enter to Capture & Translate</div>
            <div id="loading-container">
                <div class="loading-spinner"></div>
                <div class="loading-text">Processing Capture...</div>
                <div class="loading-steps">Extracting text and translating</div>
            </div>
            <div id="result-container">
                 <img id="resultImage" />
            </div>
            <div id="text-result-container">
                <textarea id="translated-text-view"></textarea>
            </div>
        </div>

        <!-- Controls are separate now -->
        <div id="controls">
            <button id="clearBtn" class="btn" style="display: none;"><i class="fas fa-sync-alt"></i><span class="tooltip">Clear</span></button>
            <button id="copyBtn" class="btn" style="display: none;"><span class="btn-icon"><i class="fas fa-copy"></i></span><span class="tooltip">Copy</span></button>
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

        <div id="language-dropdown">
            <button class="lang-option" data-lang="ja">🇯🇵 Japanese</button>
            <button class="lang-option" data-lang="en">🇺🇸 English</button>
            <button class="lang-option" data-lang="id">🇮🇩 Indonesian</button>
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
            const languageDropdown = document.getElementById('language-dropdown');
            const instructionText = document.getElementById('instruction-text');
            const loadingContainer = document.getElementById('loading-container');
            const imageViewBtn = document.getElementById('image-view-btn');
            const textViewBtn = document.getElementById('text-view-btn');
            const textResultContainer = document.getElementById('text-result-container');
            const translatedTextView = document.getElementById('translated-text-view');

            // Store the current result data for copying
            let currentResult = null;

            // Language display mapping
            const languageMap = {
                'ja': { name: 'Japanese', flag: '🇯🇵' },
                'en': { name: 'English', flag: '🇺🇸' },
                'id': { name: 'Indonesian', flag: '🇮🇩' }
            };

            // Function to show loading state
            function showLoading() {
                instructionText.style.display = 'none';
                loadingContainer.style.display = 'flex';
                resultContainer.style.display = 'none';
                textResultContainer.style.display = 'none';
            }

            // Function to hide loading state
            function hideLoading() {
                loadingContainer.style.display = 'none';
            }

            // Update language indicator when target language changes
            window.electronAPI.onTargetLanguageChanged((language) => {
                const langInfo = languageMap[language];
                if (langInfo) {
                    languageIndicator.innerHTML = 'Any → <span class="flag">' + langInfo.flag + '</span>';
                } else {
                    languageIndicator.innerHTML = 'Any → <span class="flag">❔</span>';
                }
            });

            document.addEventListener('keydown', (e) => {
                // Handle Command+Shift+T for translating textarea content FIRST
                if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
                    console.log('🎯 Command+Shift+T detected in capture overlay');
                    console.log('🔍 Text view active:', textViewBtn.classList.contains('active'));
                    
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    
                    // Only work if we're in text view (content doesn't matter since we read from clipboard)
                    if (textViewBtn.classList.contains('active')) {
                        console.log('✅ In text view, calling translateTextareaContent');
                        translateTextareaContent();
                    } else {
                        console.log('⚠️ Not in text view, switching to text view first');
                        textViewBtn.click();
                        // Give a moment for the view to switch, then translate
                        setTimeout(() => translateTextareaContent(), 100);
                    }
                    return false;
                }
                
                // Check for Enter key and that we are not already showing a result or loading
                if (e.key === 'Enter' && !container.classList.contains('result-shown') && loadingContainer.style.display !== 'flex') {
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
                textResultContainer.style.display = 'none'; // Hide text view
                container.classList.remove('result-shown'); // Restore glass and glow
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

            // Copy button functionality
            copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!currentResult) return;

                if (textViewBtn.classList.contains('active')) {
                    // In text view, copy the content of the textarea directly
                    try {
                        await window.electronAPI.copyAsText(translatedTextView.value);
                        showCopyFeedback(true, '📝');
                    } catch (error) {
                        console.error('Failed to copy translated text from textarea:', error);
                        showCopyFeedback(false, '📝');
                    }
                } else {
                    // In image view, toggle the dropdown
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
                const iconContainer = copyBtn.querySelector('.btn-icon');
                if (!iconContainer) return;

                const originalIconHTML = iconContainer.innerHTML; // Store original icon HTML

                if (success) {
                    copyBtn.style.background = 'rgba(34, 197, 94, 0.7)';
                    iconContainer.innerHTML = '<i class="fas fa-check"></i>';
                } else {
                    copyBtn.style.background = 'rgba(239, 68, 68, 0.7)';
                    iconContainer.innerHTML = '<i class="fas fa-times"></i>';
                }
                
                setTimeout(() => {
                    copyBtn.style.background = 'rgba(0,0,0,0.4)';
                    iconContainer.innerHTML = originalIconHTML; // Restore original icon
                }, 1500);
            }

            // Close dropdown when clicking elsewhere
            document.addEventListener('click', (e) => {
                // Hide copy dropdown if clicking outside of it
                if (!copyBtn.contains(e.target) && !copyDropdown.contains(e.target)) {
                    copyDropdown.style.display = 'none';
                }
                // Hide language dropdown if clicking outside of it
                if (!languageIndicator.contains(e.target) && !languageDropdown.contains(e.target)) {
                    languageDropdown.style.display = 'none';
                }
            });

            // --- Language Selector Logic ---
            languageIndicator.addEventListener('click', (e) => {
                e.stopPropagation();
                const isVisible = languageDropdown.style.display === 'flex';
                languageDropdown.style.display = isVisible ? 'none' : 'flex';
                // Hide copy dropdown if it's open
                copyDropdown.style.display = 'none';
            });

            languageDropdown.querySelectorAll('.lang-option').forEach(button => {
                button.addEventListener('click', () => {
                    const lang = button.getAttribute('data-lang');
                    window.electronAPI.setTargetLanguage(lang);
                    languageDropdown.style.display = 'none'; // Hide after selection
                });
            });

            // Listen for the translated image from main process
            window.electronAPI.onLupResult((imageDataUrl) => {
                hideLoading(); // Hide loading first
                resultImage.src = imageDataUrl;
                container.classList.add('result-shown');
                
                // Show the correct view based on the active button
                if (imageViewBtn.classList.contains('active')) {
                    textResultContainer.style.display = 'none';
                    resultContainer.style.display = 'block';
                } else {
                    resultContainer.style.display = 'none';
                    textResultContainer.style.display = 'flex';
                }

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
                // Also update the text view
                translatedTextView.value = resultData.translatedText;
            });

            // Listen for local translate shortcut from global handler
            window.electronAPI.onHandleLocalTranslateShortcut(() => {
                console.log('🎯 Received local translate shortcut message from main process');
                
                // Only work if we're in text view (content doesn't matter since we read from clipboard)
                if (textViewBtn.classList.contains('active')) {
                    console.log('✅ In text view, calling translateTextareaContent via IPC');
                    translateTextareaContent();
                } else {
                    console.log('⚠️ Not in text view, switching to text view first');
                    textViewBtn.click();
                    // Give a moment for the view to switch, then translate
                    setTimeout(() => translateTextareaContent(), 100);
                }
            });

            // Add listener to keep currentResult updated with edits
            translatedTextView.addEventListener('input', () => {
                if (currentResult) {
                    currentResult.translatedText = translatedTextView.value;
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

            // --- View Switcher Logic ---
            imageViewBtn.addEventListener('click', () => {
                if (!imageViewBtn.classList.contains('active')) {
                    imageViewBtn.classList.add('active');
                    textViewBtn.classList.remove('active');

                    // Update copy button tooltip and ensure dropdown is hidden
                    copyBtn.querySelector('.tooltip').textContent = 'Copy';
                    copyDropdown.style.display = 'none';

                    // Only switch views if a result is already shown
                    if (container.classList.contains('result-shown')) {
                        resultContainer.style.display = 'block';
                        textResultContainer.style.display = 'none';
                    }
                }
            });

            textViewBtn.addEventListener('click', () => {
                if (!textViewBtn.classList.contains('active')) {
                    textViewBtn.classList.add('active');
                    imageViewBtn.classList.remove('active');
                    
                    // Update copy button tooltip and ensure dropdown is hidden
                    copyBtn.querySelector('.tooltip').textContent = 'Copy Text';
                    copyDropdown.style.display = 'none';

                    // Only switch views if a result is already shown
                    if (container.classList.contains('result-shown')) {
                        textResultContainer.style.display = 'flex';
                        resultContainer.style.display = 'none';
                    }
                }
            });

            pasteBtn.addEventListener('click', async () => {
                try {
                    const result = await window.electronAPI.readFromClipboard();
                    if (result.success) {
                        translatedTextView.value = result.text;
                        // Manually trigger the input event to update the underlying data
                        translatedTextView.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                } catch (error) {
                    console.error('Failed to paste text:', error);
                }
            });

            // Function to translate textarea content
            async function translateTextareaContent() {
                console.log('🔄 Translating clipboard content for textarea paste...');
                
                // Read from clipboard instead of using textarea content
                let clipboardText;
                try {
                    const result = await window.electronAPI.readFromClipboard();
                    if (!result.success || !result.text || !result.text.trim()) {
                        console.log('⚠️ No text on clipboard to translate');
                        return;
                    }
                    clipboardText = result.text.trim();
                } catch (error) {
                    console.error('❌ Failed to read clipboard:', error);
                    return;
                }
                
                console.log('📋 Clipboard text:', clipboardText.substring(0, 50) + '...');
                
                // Show visual feedback
                const originalBorderStyle = translatedTextView.style.border;
                translatedTextView.style.border = '2px solid #007bff';
                
                try {
                    // Get current target language (should be available from the language indicator)
                    const langIndicatorText = languageIndicator.textContent;
                    let targetLang = 'ja'; // default
                    if (langIndicatorText.includes('🇺🇸')) targetLang = 'en';
                    else if (langIndicatorText.includes('🇮🇩')) targetLang = 'id';
                    
                    const result = await window.electronAPI.translateTextareaContent({
                        text: clipboardText,
                        targetLanguage: targetLang
                    });
                    
                    if (result.success) {
                        // Insert translated text at cursor position instead of replacing all
                        const startPos = translatedTextView.selectionStart;
                        const endPos = translatedTextView.selectionEnd;
                        const currentText = translatedTextView.value;
                        
                        // Insert the translated text at cursor position
                        const newText = currentText.substring(0, startPos) + result.translatedText + currentText.substring(endPos);
                        translatedTextView.value = newText;
                        
                        // Position cursor after the inserted text
                        const newCursorPos = startPos + result.translatedText.length;
                        translatedTextView.setSelectionRange(newCursorPos, newCursorPos);
                        translatedTextView.focus();
                        
                        // Update the stored result data
                        if (currentResult) {
                            currentResult.translatedText = newText;
                        }
                        console.log('✅ Clipboard text translated and pasted into textarea');
                        
                        // Show success feedback
                        translatedTextView.style.border = '2px solid #28a745';
                        setTimeout(() => {
                            translatedTextView.style.border = originalBorderStyle;
                        }, 1000);
                    } else {
                        console.error('Translation failed:', result.error);
                        // Show error feedback
                        translatedTextView.style.border = '2px solid #dc3545';
                        setTimeout(() => {
                            translatedTextView.style.border = originalBorderStyle;
                        }, 1000);
                    }
                } catch (error) {
                    console.error('Error translating clipboard for textarea:', error);
                    translatedTextView.style.border = '2px solid #dc3545';
                    setTimeout(() => {
                        translatedTextView.style.border = originalBorderStyle;
                    }, 1000);
                }
            }

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
      
      console.log('🎯 Capture overlay is ready and focused');
    });

    // Handle window close
    this.captureWindow.on('closed', () => {
      this.captureWindow = null;
      // Reset global shortcut flag when overlay is closed/cancelled
      this.globalShortcutInProgress = false;
      console.log('Capture overlay closed, flag reset');
      
      // After capture is closed, restore and focus the main window properly
      if (this.ensureMainWindowVisible()) {
        // Reset to home view
        this.mainWindow.webContents.send('reset-to-home');
        console.log('✅ Main window restored and ready for interaction after capture');
      }
    });
  }

  createMiniGallery() {
    if (this.miniGalleryWindow) {
      console.log('Mini gallery already exists');
      return;
    }

    const display = this.lastActiveDisplay || screen.getPrimaryDisplay();
    const { workArea } = display;

    // Gallery dimensions - START SMALL, will be resized dynamically
    const galleryWidth = 170; // Width for one item + padding
    const galleryHeight = 50; // A small initial height

    this.miniGalleryWindow = new BrowserWindow({
      width: galleryWidth,
      height: galleryHeight,
      x: workArea.x + 15, // Position relative to the active display's work area
      y: workArea.y + workArea.height - galleryHeight, // Start position, will be adjusted
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

    // Make the gallery visible on all virtual desktops (Spaces)
    this.miniGalleryWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
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
                cursor: grab; /* Change cursor to indicate draggable */
                transition: transform 0.2s ease;
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(8px);
                border: 1px solid rgba(255, 255, 255, 0.2);
                opacity: 0;
                transform: translateY(20px);
                animation: slideInUp 0.4s ease-out forwards;
                flex-shrink: 0; /* Prevent items from shrinking */
                /* Ensure consistent state */
                pointer-events: auto;
            }
            
            .gallery-item:hover {
                transform: scale(1.05);
                border-color: rgba(255, 255, 255, 0.4);
            }
            
            .gallery-item:active {
                cursor: grabbing;
            }
            
            .gallery-item.dragging {
                opacity: 0.5;
                transform: scale(0.95) rotate(5deg);
                border-color: rgba(0, 123, 255, 0.6);
                box-shadow: 0 8px 25px rgba(0,0,0,0.3);
                /* Override hover states when dragging */
                pointer-events: none;
            }
            
            /* Prevent hover effects when dragging */
            .gallery-item.dragging:hover {
                transform: scale(0.95) rotate(5deg); /* Keep drag transform */
            }
            
            .gallery-item.dragging .gallery-overlay {
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
            }
            
            .gallery-item.dragging .close-btn {
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
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
                pointer-events: none; /* Prevent interference with drag events */
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
                pointer-events: none; /* Don't interfere with drag events */
            }
            
            .gallery-item:hover .gallery-overlay {
                opacity: 1;
                visibility: visible;
                pointer-events: auto; /* Re-enable when visible */
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
            
            /* Image type indicators - clickable gradient text toggle */
            .image-type-indicator {
                position: absolute;
                top: 8px;
                left: 8px;
                font-size: 14px;
                font-weight: 900;
                cursor: pointer;
                z-index: 15;
                transition: all 0.2s ease;
                text-shadow: 0 2px 4px rgba(0,0,0,0.5);
                user-select: none;
                pointer-events: auto;
            }
            
            .image-type-indicator.translated {
                background: linear-gradient(135deg, #007bff, #0056b3);
                background-clip: text;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                text-shadow: none;
            }
            
            .image-type-indicator.original {
                background: linear-gradient(135deg, #ff9800, #e65100);
                background-clip: text;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                text-shadow: none;
            }
            
            .image-type-indicator:hover {
                transform: scale(1.2);
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
            let isDragging = false;
            let draggedItemElement = null; // Store a reliable reference to the item being dragged

            // Listen for new captures
            window.electronAPI.onGalleryUpdate && window.electronAPI.onGalleryUpdate((newCaptureData) => {
                captureData = newCaptureData;
                updateGallery();
            });

            function updateGallery() {
                const container = document.getElementById('galleryContainer');
                
                // Clear any existing drag state when updating gallery
                if (isDragging || draggedItemElement) {
                    console.log('Clearing drag state during gallery update');
                    isDragging = false;
                    draggedItemElement = null;
                }
                
                if (removingIndex === -1) {
                    container.innerHTML = '';
                    
                    captureData.forEach((capture, index) => {
                        const item = createGalleryItem(capture, index);
                        item.classList.add('entering');
                        container.appendChild(item);
                    });
                    
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
                item.setAttribute('data-drag-listeners-attached', 'true'); // Mark as having listeners
                item.draggable = true;
                
                const isTranslated = capture.translatedImageDataUrl && capture.translatedImageDataUrl !== capture.originalImageDataUrl;
                const imageToShow = capture.translatedImageDataUrl || capture.originalImageDataUrl;
                const indicatorClass = isTranslated ? 'translated' : 'original';
                const indicatorText = isTranslated ? 'T' : 'O';
                
                item.innerHTML = \`
                    <img class="gallery-image" src="\${imageToShow}" alt="Capture \${index + 1}" />
                    <div class="image-type-indicator \${indicatorClass}" data-showing="\${isTranslated ? 'translated' : 'original'}">\${indicatorText}</div>
                    <button class="close-btn"><i class="fas fa-times"></i></button>
                    <div class="gallery-overlay">
                        <div class="gallery-actions-row">
                             <button class="gallery-btn copy-btn" data-copy-type="originalImage"><i class="fas fa-camera"></i><span class="tooltip tooltip-bottom">Original Img</span></button>
                             <button class="gallery-btn copy-btn" data-copy-type="translatedImage"><i class="fas fa-image"></i><span class="tooltip tooltip-bottom">Translated Img</span></button>
                        </div>
                        <div class="gallery-actions-row">
                             <button class="gallery-btn copy-btn" data-copy-type="originalText"><i class="fas fa-file-alt"></i><span class="tooltip">Original Txt</span></button>
                             <button class="gallery-btn copy-btn" data-copy-type="translatedText"><i class="fas fa-language"></i><span class="tooltip">Translated Txt</span></button>
                        </div>
                    </div>
                \`;

                // Add double-click event listener for enlarging
                item.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (!isDragging) {
                        enlargeImage(index);
                    }
                });

                // Add event listeners with proper error handling
                const closeBtn = item.querySelector('.close-btn');
                if (closeBtn) {
                    closeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        removeItem(index, e);
                    });
                }

                const indicator = item.querySelector('.image-type-indicator');
                if (indicator) {
                    indicator.addEventListener('click', (e) => {
                        e.stopPropagation();
                        toggleImageView(index, item);
                    });
                }

                const copyButtons = item.querySelectorAll('.copy-btn');
                copyButtons.forEach(button => {
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        copyItem(index, button.dataset.copyType, button);
                    });
                });
                
                // Add drag event listeners with proper binding
                item.addEventListener('dragstart', (e) => handleDragStart(e, index));
                item.addEventListener('dragend', (e) => handleDragEnd(e));

                // Prevent drag from starting on interactive elements.
                const interactiveElements = item.querySelectorAll('button, .image-type-indicator');
                interactiveElements.forEach(el => {
                    el.addEventListener('mousedown', e => e.stopPropagation());
                    // Ensure interactive elements are always enabled
                    el.style.pointerEvents = 'auto';
                    if (el.tagName === 'BUTTON') {
                        el.disabled = false;
                    }
                });
                
                return item;
            }
            
            function enlargeImage(index) {
                const capture = captureData[index];
                if (!capture) return;
                
                // Get the current showing image (translated or original based on the indicator)
                const galleryItem = document.querySelector(\`[data-index="\${index}"]\`);
                const indicator = galleryItem ? galleryItem.querySelector('.image-type-indicator') : null;
                const currentShowing = indicator ? indicator.getAttribute('data-showing') : 'translated';
                
                const imageToShow = currentShowing === 'translated' 
                    ? (capture.translatedImageDataUrl || capture.originalImageDataUrl)
                    : capture.originalImageDataUrl;
                
                // Send request to main process to create new window
                window.electronAPI.openImageInNewWindow({
                    imageDataUrl: imageToShow,
                    capture: capture,
                    currentShowing: currentShowing
                });
            }

            function closeModal() {
                // Remove this function as we're no longer using modals
            }

            // Remove modal event listeners
            // No longer needed as we're using separate windows
            
            function toggleImageView(index, itemElement) {
                const capture = captureData[index];
                if (!capture || !capture.originalImageDataUrl || !capture.translatedImageDataUrl) return;
                
                const img = itemElement.querySelector('.gallery-image');
                const indicator = itemElement.querySelector('.image-type-indicator');
                const currentShowing = indicator.getAttribute('data-showing');
                
                if (currentShowing === 'translated') {
                    img.src = capture.originalImageDataUrl;
                    indicator.textContent = 'O';
                    indicator.className = 'image-type-indicator original';
                    indicator.setAttribute('data-showing', 'original');
                } else {
                    img.src = capture.translatedImageDataUrl;
                    indicator.textContent = 'T';
                    indicator.className = 'image-type-indicator translated';
                    indicator.setAttribute('data-showing', 'translated');
                }
            }

            function handleDragStart(e, index) {
                console.log('Drag start triggered for index:', index);
                
                // Prevent drag if already dragging or if no item element
                if (isDragging || draggedItemElement) {
                    console.log('Preventing drag - already in progress');
                    e.preventDefault();
                    return;
                }
                
                // Validate that the target is actually draggable
                const target = e.currentTarget;
                if (!target || !target.draggable) {
                    console.log('Preventing drag - target not draggable');
                    e.preventDefault();
                    return;
                }
                
                isDragging = true;
                draggedItemElement = target;
                const capture = captureData[index];
                
                if (!capture) {
                    console.log('No capture data found for index:', index);
                    isDragging = false;
                    draggedItemElement = null;
                    e.preventDefault();
                    return;
                }
                
                console.log('Starting drag for capture:', capture.id);
                
                // Add visual feedback
                draggedItemElement.classList.add('dragging');
                
                // Determine which image to drag
                const indicator = draggedItemElement.querySelector('.image-type-indicator');
                const currentShowing = indicator ? indicator.getAttribute('data-showing') : 'translated';
                const currentImageDataUrl = currentShowing === 'translated' 
                    ? (capture.translatedImageDataUrl || capture.originalImageDataUrl)
                    : capture.originalImageDataUrl;
                
                // Set drag data
                e.dataTransfer.setData('text/plain', 'TransPad AI Image');
                e.dataTransfer.effectAllowed = 'copy';
                
                // Start the drag operation in the main process
                window.electronAPI.startImageDrag({
                    imageDataUrl: currentImageDataUrl
                });
                
                console.log('Drag operation started successfully');
            }
            
            function handleDragEnd(e) {
                console.log('Drag end triggered');
                
                // Use the stored reference, as e.target can be unreliable.
                const item = draggedItemElement;
                if (!item) {
                    console.log('No dragged item element found');
                    return;
                }

                // Reset all state flags to prepare for the next operation.
                isDragging = false;
                draggedItemElement = null;

                // Visually reset the item.
                item.classList.remove('dragging');

                // CRITICAL: Force a complete state reset
                
                // 1. Ensure the item is draggable again
                item.draggable = true;
                
                // 2. Reset all CSS properties that might have been modified
                item.style.opacity = '';
                item.style.transform = '';
                item.style.pointerEvents = '';
                
                // 3. Force reset overlay and close button visibility states
                const overlay = item.querySelector('.gallery-overlay');
                const closeBtn = item.querySelector('.close-btn');
                const indicator = item.querySelector('.image-type-indicator');
                const allButtons = item.querySelectorAll('button');
                
                if (overlay) {
                    overlay.style.opacity = '';
                    overlay.style.visibility = '';
                    overlay.style.pointerEvents = '';
                    overlay.removeAttribute('style');
                }
                
                if (closeBtn) {
                    closeBtn.style.opacity = '';
                    closeBtn.style.visibility = '';
                    closeBtn.style.pointerEvents = '';
                    closeBtn.disabled = false;
                    closeBtn.removeAttribute('style');
                }
                
                if (indicator) {
                    indicator.style.pointerEvents = '';
                    indicator.style.opacity = '';
                    indicator.style.transform = '';
                    indicator.disabled = false;
                }
                
                // 4. Reset all buttons to their default state
                allButtons.forEach(button => {
                    button.disabled = false;
                    button.style.pointerEvents = '';
                    button.style.opacity = '';
                    button.style.visibility = '';
                    button.style.background = '';
                    button.style.transform = '';
                    button.removeAttribute('style');
                });
                
                // 5. Force a DOM reflow to ensure changes are applied
                item.offsetHeight; // Reading this property forces a reflow
                
                // 6. Re-add event listeners if they were somehow lost
                setTimeout(() => {
                    // Check if drag events are still attached, if not, re-attach them
                    if (!item.hasAttribute('data-drag-listeners-attached')) {
                        const index = parseInt(item.getAttribute('data-index'));
                        
                        // Remove old listeners first
                        item.removeEventListener('dragstart', handleDragStart);
                        item.removeEventListener('dragend', handleDragEnd);
                        
                        // Re-attach drag listeners
                        item.addEventListener('dragstart', (e) => handleDragStart(e, index));
                        item.addEventListener('dragend', (e) => handleDragEnd(e));
                        
                        // Mark as having listeners attached
                        item.setAttribute('data-drag-listeners-attached', 'true');
                    }
                    
                    // Ensure all interactive elements are responsive
                    const interactiveElements = item.querySelectorAll('button, .image-type-indicator');
                    interactiveElements.forEach(el => {
                        el.style.pointerEvents = 'auto';
                        el.disabled = false;
                    });
                    
                    console.log('Drag operation fully reset with event listener restoration');
                }, 10);

                // Notify the main process to clean up any temporary files.
                window.electronAPI.endImageDrag();
                console.log('Drag operation ended and item state was forcefully reset.');
            }

            async function copyItem(index, type, buttonElement) {
                const capture = captureData[index];
                if (!capture) return;

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
                    if (success) {
                        showCopyFeedback(buttonElement, true);
                    } else {
                        showCopyFeedback(buttonElement, false);
                    }
                } catch (error) {
                    console.error('Copy failed:', error);
                    showCopyFeedback(buttonElement, false);
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
                    
                    setTimeout(() => {
                        window.electronAPI.removeFromGallery(index);
                        removingIndex = -1;
                    }, 400);
                }
            }

        </script>
    </body>
    </html>`;

    this.miniGalleryWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(galleryHtml));

    this.miniGalleryWindow.once('ready-to-show', () => {
      console.log('Mini gallery window ready but staying hidden until screenshots are added');
    });

    this.miniGalleryWindow.on('closed', () => {
      this.miniGalleryWindow = null;
    });

    console.log('Mini gallery window created (hidden)');
  }

  createImageViewerWindow(imageData) {
    // --- SINGLETON LOGIC ---
    if (this.imageViewerWindow && !this.imageViewerWindow.isDestroyed()) {
      console.log('Image viewer already open, updating image...');
      this.imageViewerWindow.webContents.send('update-image', imageData);
      this.imageViewerWindow.focus();
      return;
    }

    // --- WINDOW CREATION (if not already open) ---
    const display = this.lastActiveDisplay || screen.getPrimaryDisplay();
    const { workArea } = display;
    
    const windowWidth = Math.round(workArea.width * 0.6);
    const windowHeight = Math.round(workArea.height * 0.6);
    
    const x = workArea.x + Math.round((workArea.width - windowWidth) / 2);
    const y = workArea.y + Math.round((workArea.height - windowHeight) / 2);

    this.imageViewerWindow = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x: x,
      y: y,
      title: 'TransPad AI - Image Viewer',
      transparent: true,
      frame: false,
      alwaysOnTop: false,
      skipTaskbar: false,
      resizable: true,
      movable: true,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      icon: path.join(__dirname, '../../assets/icons/transpad_512x512.png')
    });

    const viewerHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            body { background-color: transparent; margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; overflow: hidden; }
            #container { position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 12px; background: rgba(30, 30, 30, 0.75); backdrop-filter: blur(25px); border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 20px 60px rgba(0,0,0,0.5); display: flex; flex-direction: column; }
            .header { height: 50px; flex-shrink: 0; display: flex; align-items: center; padding: 0 15px; -webkit-app-region: drag; }
            .content { flex-grow: 1; display: flex; justify-content: center; align-items: center; padding: 0 20px 20px 20px; -webkit-app-region: no-drag; overflow: hidden; }
            .viewer-image { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); }
            .title { color: rgba(255,255,255,0.7); font-weight: 600; font-size: 14px; margin: 0 auto; }
            .btn { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8); border: none; width: 32px; height: 32px; border-radius: 50%; font-size: 14px; cursor: pointer; display: flex; justify-content: center; align-items: center; transition: all 0.2s ease; -webkit-app-region: no-drag; position: absolute; }
            #closeBtn { top: 9px; left: 15px; }
            #closeBtn:hover { background: rgba(239, 68, 68, 0.8); color: white; }
            #toggleBtn { top: 9px; right: 15px; width: auto; padding: 0 12px; border-radius: 16px; font-size: 12px; font-weight: 500; }
            #toggleBtn:hover { background: rgba(255,255,255,0.2); }
        </style>
    </head>
    <body>
        <div id="container">
            <div class="header">
                <button id="closeBtn" class="btn"><i class="fas fa-times"></i></button>
                <span class="title">Image Viewer</span>
                <button id="toggleBtn" class="btn" style="${imageData.capture.originalImageDataUrl === imageData.capture.translatedImageDataUrl ? 'display: none;' : ''}">
                    Switch to ${imageData.currentShowing === 'translated' ? 'Original' : 'Translated'}
                </button>
            </div>
            <div class="content">
                <img class="viewer-image" id="viewerImage" src="${imageData.imageDataUrl}" alt="Screenshot">
            </div>
        </div>

        <script>
            let currentShowing, captureData;
            const viewerImage = document.getElementById('viewerImage');
            const toggleBtn = document.getElementById('toggleBtn');
            const closeBtn = document.getElementById('closeBtn');

            function updateContent(data) {
                currentShowing = data.currentShowing;
                captureData = data.capture;
                viewerImage.src = data.imageDataUrl;
                toggleBtn.textContent = \`Switch to \${currentShowing === 'translated' ? 'Original' : 'Translated'}\`;
                toggleBtn.style.display = captureData.originalImageDataUrl === captureData.translatedImageDataUrl ? 'none' : 'block';
            }

            toggleBtn.addEventListener('click', () => {
                if (currentShowing === 'translated') {
                    viewerImage.src = captureData.originalImageDataUrl;
                    toggleBtn.textContent = 'Switch to Translated';
                    currentShowing = 'original';
                } else {
                    viewerImage.src = captureData.translatedImageDataUrl;
                    toggleBtn.textContent = 'Switch to Original';
                    currentShowing = 'translated';
                }
            });

            closeBtn.addEventListener('click', () => window.close());
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
            
            // Listen for updates to replace the image
            window.electronAPI.onUpdateImage((newImageData) => {
                updateContent(newImageData);
            });
            
            // Initial load
            updateContent(${JSON.stringify(imageData)});
        </script>
    </body>
    </html>`;

    this.imageViewerWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(viewerHtml));

    this.imageViewerWindow.once('ready-to-show', () => {
      this.imageViewerWindow.show();
      this.imageViewerWindow.focus();
    });

    this.imageViewerWindow.on('closed', () => {
      this.imageViewerWindow = null;
    });
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
    console.log('📋 Loading shortcuts from store:', shortcuts);
    
    // Register capture & translate shortcut
    try {
      if (shortcuts['capture-translate'] && shortcuts['capture-translate'].trim()) {
        const success = globalShortcut.register(shortcuts['capture-translate'], async () => {
          try {
            if (this.shortcutsRecordingActive) return;
            const now = Date.now();
            if (now - this.lastShortcutTime < 2000) return;
            if (this.globalShortcutInProgress) return;
            if (this.captureWindow) return;
            this.globalShortcutInProgress = true;
            this.lastShortcutTime = now;
            const hasPermission = await this.checkScreenPermissions(false);
            if (!hasPermission) {
              this.showPermissionToast('TransPad AI needs Screen Recording permission. Please grant it in System Settings.');
              this.globalShortcutInProgress = false;
              return;
            }
            if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.hide();
            const cursor = screen.getCursorScreenPoint();
            this.createCaptureOverlay(cursor);
          } catch (error) {
            console.error('Error in capture shortcut callback:', error);
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.show();
              this.mainWindow.focus();
            }
            this.globalShortcutInProgress = false;
            this.lastShortcutTime = 0;
          }
        });
        if (!success) console.error('❌ Failed to register capture & translate shortcut:', shortcuts['capture-translate']);
      }
    } catch (error) {
      console.error('Error registering capture-translate shortcut:', error);
    }

    // Register global shortcut for clipboard translation
    try {
      if (shortcuts['translate-paste'] && shortcuts['translate-paste'].trim()) {
        const success = globalShortcut.register(shortcuts['translate-paste'], async () => {
          try {
            if (this.shortcutsRecordingActive) return;
            if (this.captureWindow && !this.captureWindow.isDestroyed() && this.captureWindow.isFocused()) {
              this.captureWindow.webContents.send('handle-local-translate-shortcut');
              return;
            }
            await this.translateAndReplaceClipboard();
          } catch (error) {
            console.error('❌ Error in translate-paste shortcut callback:', error);
          }
        });
        if (!success) console.error('❌ Failed to register translate-paste shortcut:', shortcuts['translate-paste']);
      }
    } catch (error) {
      console.error('Error registering translate-paste shortcut:', error);
    }

    // Register global shortcut for AI clipboard improve+translate
    try {
      if (shortcuts['ai-translate-paste'] && shortcuts['ai-translate-paste'].trim()) {
        const success = globalShortcut.register(shortcuts['ai-translate-paste'], async () => {
          try {
            if (this.shortcutsRecordingActive) return;
            await this.aiImproveAndReplaceClipboard();
          } catch (error) {
            console.error('❌ Error in AI translate-paste shortcut callback:', error);
          }
        });
        if (!success) console.error('❌ Failed to register AI translate-paste shortcut:', shortcuts['ai-translate-paste']);
      }
    } catch (error) {
      console.error('Error registering AI translate-paste shortcut:', error);
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
        // REMOVED: Unnecessary delay was here.
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
        
        // --- Multi-monitor support: Determine the active display ---
        const activeDisplay = screen.getDisplayMatching(bounds);
        
        // --- Hide, screenshot, then show to avoid flicker ---
        this.captureWindow.hide();
        await new Promise(resolve => setTimeout(resolve, 60)); 
        const screenshot = await this.screenshotService.captureFullScreenBackground(activeDisplay);
        this.captureWindow.show();
        
        // --- Show progress step 1: Extracting ---
        if (this.captureWindow && !this.captureWindow.isDestroyed()) {
          this.captureWindow.webContents.send('update-loading-step', 'Extracting text from image...');
        }
        
        const imagePath = await this.screenshotService.captureAreaFromExisting(
          bounds, 
          screenshot.filePath,
          activeDisplay // Pass the active display for coordinate calculations
        );
        
        const extractionResult = await this.visionService.extractText(imagePath);
        
        // --- Show progress step 2: Translating ---
        if (this.captureWindow && !this.captureWindow.isDestroyed()) {
          this.captureWindow.webContents.send('update-loading-step', 'Translating text...');
        }

        // --- Show progress step 3: Creating Image ---
        if (this.captureWindow && !this.captureWindow.isDestroyed()) {
          this.captureWindow.webContents.send('update-loading-step', 'Creating translated image...');
        }

        const quality = this.storeService.store.get('captureQuality', 'medium');
        const translationResult = await this.screenshotService.createImageWithTranslation(
          imagePath, 
          extractionResult.fullText, 
          extractionResult.textBlocks,
          this.targetLanguage,
          quality
        );

        this.lastLupResult = {
          id: `cap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          success: true,
          originalText: extractionResult.fullText,
          translatedText: translationResult.fullTranslatedText,
          imagePath: imagePath,
          detectedLanguage: translationResult.detectedLanguage,
          targetLanguage: this.targetLanguage,
          textBlocks: extractionResult.textBlocks
        };
        
        // --- CORRECTED LOGIC ---
        // 1. Send to history immediately after capture.
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          console.log('Sending capture result to main window for history.');
          this.mainWindow.webContents.send('capture-complete', this.lastLupResult);
        }

        // Store the active display for positioning the gallery
        this.lastActiveDisplay = activeDisplay; 
        
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
      console.log('🎯 Open in app button clicked');
      
      if (this.ensureMainWindowVisible()) {
        console.log('📋 Last result data:', this.lastLupResult ? 'Available' : 'Not available');
        
        // Send the last result to be displayed in the modal
        if (this.lastLupResult) {
          console.log('📤 Sending capture-complete event to renderer with:', {
            success: this.lastLupResult.success,
            originalText: this.lastLupResult.originalText ? this.lastLupResult.originalText.substring(0, 50) + '...' : 'None',
            translatedText: this.lastLupResult.translatedText ? this.lastLupResult.translatedText.substring(0, 50) + '...' : 'None'
          });
          
          // Wait a moment for window to be ready, then send the result
          setTimeout(() => {
            this.mainWindow.webContents.send('capture-complete', this.lastLupResult);
            console.log('✅ Capture-complete event sent to main window');
          }, 100);
        } else {
          console.warn('⚠️ No lastLupResult available to send');
        }
        
        // Close capture window
        if (this.captureWindow) {
          this.captureWindow.close();
          console.log('❌ Capture window closed');
        }
        
        console.log('✅ Open in app completed successfully');
      } else {
        console.error('❌ Could not open in app: Main window is not available.');
      }
    });

    ipcMain.handle('close-capture-overlay', () => {
      if (this.captureWindow) {
        this.captureWindow.close();
      }
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
        // Convert data URL to native image and copy to clipboard
        const image = nativeImage.createFromDataURL(imageDataUrl);
        clipboard.writeImage(image);
        
        // Generate the filename that would be used if this were saved as a file
        const timestamp = this.formatDateForFilename(new Date());
        const intendedFilename = `TransPad ${timestamp}.png`;
        
        console.log('Image copied to clipboard successfully (intended filename:', intendedFilename + ')');
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

    // Image drag operations
    ipcMain.handle('start-image-drag', async (event, dragData) => {
      try {
        const { imageDataUrl } = dragData;
        
        // Convert data URL to buffer
        const base64Data = imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        // Create temporary file for drag operation
        const tempDir = path.join(app.getPath('userData'), 'temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Use TransPad naming format with timestamp
        const timestamp = this.formatDateForFilename(new Date());
        const tempFilePath = path.join(tempDir, `TransPad ${timestamp}.png`);
        fs.writeFileSync(tempFilePath, imageBuffer);
        
        // Store the temp file path for cleanup
        this.currentDragFilePath = tempFilePath;
        
        // Start the drag operation with the temporary file
        event.sender.startDrag({
          file: tempFilePath,
          icon: nativeImage.createFromPath(tempFilePath).resize({ width: 64, height: 64 })
        });
        
        console.log('Started drag operation with temp file:', tempFilePath);
        return { success: true };
      } catch (error) {
        console.error('Error starting image drag:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('end-image-drag', async () => {
      try {
        // Clean up temporary drag file after a delay (user might still be dragging)
        if (this.currentDragFilePath) {
          setTimeout(() => {
            try {
              if (fs.existsSync(this.currentDragFilePath)) {
                fs.unlinkSync(this.currentDragFilePath);
                console.log('Cleaned up drag temp file:', this.currentDragFilePath);
              }
            } catch (error) {
              console.warn('Failed to cleanup drag temp file:', error);
            }
            this.currentDragFilePath = null;
          }, 2000); // 2 second delay to ensure drag operation is complete
        }
        
        return { success: true };
      } catch (error) {
        console.error('Error ending image drag:', error);
        return { success: false, error: error.message };
      }
    });

    // Image viewer window operations
    ipcMain.handle('open-image-in-new-window', async (event, imageData) => {
      try {
        console.log('Creating new image viewer window');
        this.createImageViewerWindow(imageData);
        return { success: true };
      } catch (error) {
        console.error('Error creating image viewer window:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('read-from-clipboard', async () => {
      try {
        const text = clipboard.readText();
        return { success: true, text: text };
      } catch (error) {
        console.error('Error reading from clipboard:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('refresh-background-screenshot', async () => {
      try {
        console.log('🔄 Refreshing background screenshot...');
        
        if (!this.captureWindow) {
          return { success: false, error: 'No capture window available' };
        }
        
        const bounds = this.captureWindow.getBounds();
        const activeDisplay = screen.getDisplayMatching(bounds);
        
        // Take a fresh screenshot of the background
        const screenshot = await this.screenshotService.captureFullScreenBackground(activeDisplay);
        
        console.log('✅ Background screenshot refreshed');
        return { success: true };
      } catch (error) {
        console.error('❌ Failed to refresh background screenshot:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('translate-textarea-content', async (event, { text, targetLanguage }) => {
      try {
        console.log('🔄 Translating textarea content:', text.substring(0, 50) + '...');
        const translatedText = await this.translationService.translateText(text, targetLanguage);
        console.log('✅ Textarea translation completed');
        return { success: true, translatedText };
      } catch (error) {
        console.error('❌ Error translating textarea content:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('get-openai-settings', async () => {
      try {
        return this.storeService.getOpenAISettings();
      } catch (error) {
        console.error('Failed to get OpenAI settings:', error);
        return { model: 'gpt4', prompt: '', apiKey: '' };
      }
    });

    ipcMain.handle('set-openai-settings', async (event, settings) => {
      try {
        this.storeService.setOpenAISettings(settings);
        this.openAIService.refreshClient();
        this.createMenu();
        return { success: true };
      } catch (error) {
        console.error('Failed to set OpenAI settings:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('reset-openai-settings', async () => {
      try {
        const defaults = this.storeService.resetOpenAISettings();
        this.openAIService.refreshClient();
        return { success: true, settings: defaults };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  formatDateForFilename(date) {
    const pad = (num) => num.toString().padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}-${month}-${day} ${hours}.${minutes}.${seconds}`;
  }

  async startScreenCaptureWithoutPreCapture(cursorPosition = null) {
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
      this.createCaptureOverlay(cursorPosition);
      
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

      // Show loading overlay
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('show-loading');
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
      const quality = this.storeService.store.get('captureQuality', 'medium');
      const translationResult = await this.screenshotService.createImageWithTranslation(
        imagePath,
        extractionResult.fullText,
        extractionResult.textBlocks,
        this.targetLanguage,
        quality
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
    } finally {
      // Hide loading overlay
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('hide-loading');
      }
    }
  }

  async checkAccessibilityPermissions() {
    if (process.platform !== 'darwin') {
      return true; // Non-macOS platforms don't need this
    }

    try {
      const { exec } = require('child_process');
      
      // Check if we have accessibility permissions by trying a simple keystroke test
      return new Promise((resolve) => {
        const testScript = `osascript -e 'tell application "System Events" to key code 53'`; // ESC key test
        exec(testScript, { timeout: 1000 }, (error, stdout, stderr) => {
          if (error && error.message.includes('1002')) {
            console.log('❌ Accessibility permissions not granted');
            resolve(false);
          } else {
            console.log('✅ Accessibility permissions available');
            resolve(true);
          }
        });
      });
    } catch (error) {
      console.error('Error checking accessibility permissions:', error);
      return false;
    }
  }

  async requestAccessibilityPermissions() {
    try {
      const result = await dialog.showMessageBox(this.mainWindow, {
        type: 'info',
        title: 'Accessibility Permission Required',
        message: 'TransPad AI needs accessibility permission to paste translated text automatically.',
        detail: 'Please grant permission in System Preferences > Security & Privacy > Privacy > Accessibility.\n\nAfter granting permission, the translate & paste shortcut will work seamlessly.',
        buttons: ['Open System Preferences', 'Skip Auto-Paste'],
        defaultId: 0
      });
      
      if (result.response === 0) {
        // Open System Preferences to Accessibility section
        const { exec } = require('child_process');
        exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
      }
      
      return result.response === 0;
    } catch (error) {
      console.error('Error requesting accessibility permissions:', error);
      return false;
    }
  }

  async translateAndReplaceClipboard() {
    console.log('🚀 translateAndReplaceClipboard function called');
    
    try {
      console.log('📋 Reading clipboard content...');
      const text = clipboard.readText();
      console.log('📋 Clipboard text length:', text ? text.length : 0);
      console.log('📋 Clipboard text preview:', text ? text.substring(0, 50) + '...' : 'empty');
      
      if (!text || text.trim() === '') {
        console.log('❌ No text on clipboard to translate.');
        return;
      }

      console.log(`🔄 Translating clipboard text to ${this.targetLanguage}: "${text.substring(0, 30)}..."`);

      const translatedText = await this.translationService.translateText(text, this.targetLanguage);
      console.log('✅ Translation completed:', translatedText ? translatedText.substring(0, 50) + '...' : 'empty');
      
      if (!translatedText) {
        throw new Error('Translation service failed to return a result.');
      }

      // Put the translated text on the clipboard
      clipboard.writeText(translatedText);
      console.log('📋 Translated text written to clipboard');
      
      // Wait a moment for clipboard to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check accessibility permissions first
      const hasAccessibility = await this.checkAccessibilityPermissions();
      
      if (!hasAccessibility) {
        console.log('⚠️ No accessibility permissions - auto-paste disabled');
        console.log('📋 Translated text is on clipboard, ready for manual paste with ⌘V');
        
        // For first-time users, show permission dialog (but only once per session)
        if (!this.accessibilityPermissionAsked) {
          this.accessibilityPermissionAsked = true;
          setTimeout(() => {
            this.requestAccessibilityPermissions();
          }, 500); // Small delay to not interrupt the workflow
        }
        
        // Store result and exit - text is ready for manual paste
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
        
        console.log('🎉 Translation completed - text ready for manual paste');
        return;
      }

      // We have permissions, proceed with auto-paste
      const { exec } = require('child_process');
      
      console.log('🎯 Attempting auto-paste...');
      
      try {
        // Use simplified AppleScript approach since we have permissions
        const pasteScript = `osascript -e 'delay 0.1' -e 'tell application "System Events" to key code 9 using command down'`;
        
        await new Promise((resolve, reject) => {
          exec(pasteScript, { timeout: 2000 }, (error, stdout, stderr) => {
            if (error) {
              console.log('❌ Auto-paste failed:', error.message);
              reject(error);
            } else {
              console.log('✅ Auto-paste completed successfully');
              resolve();
            }
          });
        });
        
      } catch (pasteError) {
        console.log('⚠️ Auto-paste failed, text remains on clipboard for manual paste');
        console.log('📋 Error details:', pasteError.message);
      }

      // Store this as the last result for future reference  
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

      console.log('💾 Stored result for reference');
      console.log('🎉 Clipboard translation process completed successfully');

    } catch (error) {
      console.error('❌ Error in translateAndReplaceClipboard:', error);
    }
  }

  async aiImproveAndReplaceClipboard() {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('show-loading');
      }

      const text = clipboard.readText();
      if (!text || !text.trim()) {
        this.mainWindow?.webContents?.send('show-toast', { message: 'No text on clipboard to process.', type: 'warning' });
        return;
      }

      const targetLanguage = this.targetLanguage || this.storeService.getTargetLanguage() || 'en';
      const { model, prompt } = this.storeService.getOpenAISettings();

      const improved = await this.openAIService.improveAndTranslate(text, targetLanguage, prompt, model);

      clipboard.writeText(improved);
      await new Promise(resolve => setTimeout(resolve, 150));

      const hasAccessibility = await this.checkAccessibilityPermissions();
      if (!hasAccessibility) {
        this.mainWindow?.webContents?.send('show-toast', { message: 'Processed text copied. Paste with ⌘V. Enable Accessibility for auto-paste.', type: 'info' });
        return;
      }

      // Auto-paste attempt
      const { exec } = require('child_process');
      await new Promise((resolve, reject) => {
        const pasteScript = `osascript -e 'delay 0.1' -e 'tell application "System Events" to key code 9 using command down'`;
        exec(pasteScript, { timeout: 2000 }, (error) => {
          if (error) return reject(error);
          resolve();
        });
      });

      // Store last result
      this.lastLupResult = {
        id: `ai-text-replace-${Date.now()}`,
        success: true,
        originalText: text,
        translatedText: improved,
        imagePath: null,
        detectedLanguage: 'unknown',
        targetLanguage: targetLanguage,
        textBlocks: []
      };

    } catch (error) {
      console.error('AI clipboard processing failed:', error);
      const message = error?.message || 'OpenAI request failed';
      const { model } = this.storeService.getOpenAISettings ? this.storeService.getOpenAISettings() : { model: 'gpt4' };
      const displayModel = (model || '').toUpperCase();

      // Fallback text placed on clipboard so the user gets immediate feedback
      const fallbackText = `[AI Translation Error - ${displayModel}] ${message}`;
      try {
        clipboard.writeText(fallbackText);
        // Try auto-paste if we have permissions
        const hasAccessibility = await this.checkAccessibilityPermissions();
        if (hasAccessibility) {
          const { exec } = require('child_process');
          await new Promise((resolve, reject) => {
            const pasteScript = `osascript -e 'delay 0.1' -e 'tell application "System Events" to key code 9 using command down'`;
            exec(pasteScript, { timeout: 2000 }, (err) => (err ? reject(err) : resolve()));
          });
        } else {
          // Inform user to paste manually
          this.mainWindow?.webContents?.send('show-toast', { message: 'AI error. Fallback message copied to clipboard. Paste with ⌘V.', type: 'error' });
        }
      } catch (pasteErr) {
        // If auto-paste fails, at least the text is on clipboard
        this.mainWindow?.webContents?.send('show-toast', { message: 'AI error. Fallback message copied to clipboard.', type: 'error' });
      }

      // Also surface the specific error in a toast for visibility
      this.mainWindow?.webContents?.send('show-toast', { message, type: 'error' });
    } finally {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('hide-loading');
      }
    }
  }
}

new App();