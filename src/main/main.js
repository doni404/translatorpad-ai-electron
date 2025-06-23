const { app, BrowserWindow, ipcMain, globalShortcut, screen, desktopCapturer, dialog, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { VisionService } = require('./services/visionService');
const { TranslationService } = require('./services/translationService');
const { ScreenshotService } = require('./services/screenshotService');

class App {
  constructor() {
    this.mainWindow = null;
    this.captureWindow = null;
    this.visionService = new VisionService();
    this.translationService = new TranslationService();
    this.screenshotService = new ScreenshotService();
    this.hasUsedCaptureSuccessfully = false;
    
    this.init();
  }

  init() {
    app.whenReady().then(() => {
      this.createMainWindow();
      this.registerShortcuts();
      this.setupIpcHandlers();
      this.checkScreenPermissions();
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
      titleBarStyle: 'default',
      movable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        preload: path.join(__dirname, 'preload.js')
      },
      icon: path.join(__dirname, '../../assets/icons/icon.png')
    });

    this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Only open dev tools if explicitly requested
    const isDev = process.argv.includes('--dev');
    if (isDev && process.argv.includes('--debug')) {
      this.mainWindow.webContents.openDevTools();
    }

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  createCaptureOverlay() {
    // Get primary display for global screen capture
    const primaryDisplay = screen.getPrimaryDisplay();
    
    // Store display info for coordinate conversion
    this.displayInfo = {
      bounds: primaryDisplay.bounds,
      scaleFactor: primaryDisplay.scaleFactor || 1,
      workArea: primaryDisplay.workArea
    };
    
    console.log('Creating capture overlay with display info:', this.displayInfo);
    
    // Create overlay that covers the entire primary display
    // This ensures it works regardless of which app is currently focused
    this.captureWindow = new BrowserWindow({
      x: 0,  // Always start at screen origin
      y: 0,  // Always start at screen origin
      width: primaryDisplay.bounds.width,
      height: primaryDisplay.bounds.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreen: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    // Create capture overlay HTML content for global capture
    const captureHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            body {
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                background: rgba(0, 0, 0, 0.3);
                width: 100vw;
                height: 100vh;
                cursor: crosshair;
                overflow: hidden;
                user-select: none;
                position: fixed;
                top: 0;
                left: 0;
            }
            .instructions {
                position: fixed;
                top: 30px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.9);
                color: white;
                padding: 15px 25px;
                border-radius: 10px;
                font-size: 16px;
                z-index: 10001;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            .selection-box {
                position: absolute;
                border: 3px solid #007AFF;
                background: rgba(0, 122, 255, 0.1);
                display: none;
                z-index: 10000;
                pointer-events: none;
            }
            .selection-box::before {
                content: '';
                position: absolute;
                top: -3px;
                left: -3px;
                right: -3px;
                bottom: -3px;
                border: 1px dashed rgba(255, 255, 255, 0.8);
                border-radius: 2px;
                animation: dash 2s linear infinite;
            }
            @keyframes dash {
                0% { stroke-dashoffset: 0; }
                100% { stroke-dashoffset: 20px; }
            }
            .corner-handle {
                position: absolute;
                width: 10px;
                height: 10px;
                background: #007AFF;
                border: 2px solid white;
                border-radius: 50%;
                z-index: 10002;
            }
            .corner-handle.top-left { top: -5px; left: -5px; }
            .corner-handle.top-right { top: -5px; right: -5px; }
            .corner-handle.bottom-left { bottom: -5px; left: -5px; }
            .corner-handle.bottom-right { bottom: -5px; right: -5px; }
            .dimensions {
                position: absolute;
                top: -35px;
                left: 0;
                background: rgba(0, 0, 0, 0.9);
                color: white;
                padding: 6px 10px;
                border-radius: 6px;
                font-size: 12px;
                font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
                font-weight: 500;
                white-space: nowrap;
                z-index: 10003;
            }
        </style>
    </head>
    <body>
        <div class="instructions">
            🔍 <strong>Click and drag</strong> to select an area to capture • Press <strong>ESC</strong> to cancel
        </div>
        <div class="selection-box" id="selectionBox">
            <div class="corner-handle top-left"></div>
            <div class="corner-handle top-right"></div>
            <div class="corner-handle bottom-left"></div>
            <div class="corner-handle bottom-right"></div>
            <div class="dimensions" id="dimensions"></div>
        </div>
        
        <script>
            let isSelecting = false;
            let startX, startY;
            const selectionBox = document.getElementById('selectionBox');
            const dimensions = document.getElementById('dimensions');

            // Global capture - coordinates are relative to entire screen
            document.addEventListener('mousedown', (e) => {
                isSelecting = true;
                startX = e.clientX;
                startY = e.clientY;
                
                selectionBox.style.display = 'block';
                selectionBox.style.left = startX + 'px';
                selectionBox.style.top = startY + 'px';
                selectionBox.style.width = '0px';
                selectionBox.style.height = '0px';
                
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isSelecting) return;
                
                const currentX = e.clientX;
                const currentY = e.clientY;
                
                const left = Math.min(startX, currentX);
                const top = Math.min(startY, currentY);
                const width = Math.abs(currentX - startX);
                const height = Math.abs(currentY - startY);
                
                selectionBox.style.left = left + 'px';
                selectionBox.style.top = top + 'px';
                selectionBox.style.width = width + 'px';
                selectionBox.style.height = height + 'px';
                
                // Update dimensions display
                if (width > 50 && height > 20) {
                    dimensions.textContent = \`\${width} × \${height}\`;
                    dimensions.style.display = 'block';
                } else {
                    dimensions.style.display = 'none';
                }
                
                e.preventDefault();
            });

            document.addEventListener('mouseup', (e) => {
                if (!isSelecting) return;
                
                const currentX = e.clientX;
                const currentY = e.clientY;
                
                const left = Math.min(startX, currentX);
                const top = Math.min(startY, currentY);
                const width = Math.abs(currentX - startX);
                const height = Math.abs(currentY - startY);
                
                // Only capture if selection is large enough
                if (width > 10 && height > 10) {
                    // Send coordinates directly (they're already in screen coordinates)
                    window.electronAPI.captureArea({
                        x: left,
                        y: top,
                        width: width,
                        height: height,
                        // Store raw coordinates for precise capture
                        rawLeft: left,
                        rawTop: top,
                        // Include display info for coordinate system reference
                        displayBounds: {
                            x: 0,
                            y: 0,
                            width: window.screen.width,
                            height: window.screen.height
                        },
                        scalingRatio: window.devicePixelRatio
                    });
                }
                
                // Reset selection state
                isSelecting = false;
                selectionBox.style.display = 'none';
                
                e.preventDefault();
            });

            // ESC key to cancel
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    window.electronAPI.closeCaptureOverlay();
                }
            });

            // Prevent context menu
            document.addEventListener('contextmenu', (e) => {
                e.preventDefault();
            });
        </script>
    </body>
    </html>`;

    // Load the HTML content directly
    this.captureWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(captureHtml));

    // Ensure window is focused and on top
    this.captureWindow.once('ready-to-show', () => {
      this.captureWindow.show();
      this.captureWindow.focus();
      this.captureWindow.setAlwaysOnTop(true, 'screen-saver');
    });

    // Handle window close
    this.captureWindow.on('closed', () => {
      this.captureWindow = null;
    });
  }

  registerShortcuts() {
    globalShortcut.register('CommandOrControl+Shift+S', async () => {
      console.log('Global shortcut pressed - starting smart capture sequence...');
      
      try {
        // Check permissions first
        const hasPermission = await this.checkScreenPermissions();
        if (!hasPermission) {
          console.log('Screen recording permission denied, aborting capture');
          return;
        }
        
        // Additional check for first-time permission dialog
        // On first use, macOS may show a system dialog even if permission check passes
        const isFirstTimeUse = !this.hasUsedCaptureSuccessfully;
        if (isFirstTimeUse) {
          console.log('First time capture - allowing extra time for system dialogs...');
          // Wait longer to ensure any system dialogs are handled
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // NEW STRATEGY: Use system APIs to properly handle window switching
        
        // Step 1: Get the current frontmost app before we interfere
        const frontmostApp = await this.getFrontmostApplication();
        console.log('Frontmost app detected:', frontmostApp);
        
        // Step 2: Hide G-Pad AI completely (not just minimize)
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.hide();
        }
        
        // Step 3: If the frontmost app wasn't G-Pad AI, try to restore it
        if (frontmostApp && frontmostApp !== 'G-Pad AI' && frontmostApp !== 'Electron') {
          console.log(`Attempting to restore ${frontmostApp}...`);
          await this.restoreFrontmostApp(frontmostApp);
          
          // Wait for the app to redraw
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          // If G-Pad AI was frontmost, just wait for desktop
          console.log('G-Pad AI was frontmost, waiting for desktop...');
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        // Step 4: Take screenshot
        console.log('Taking screenshot of current state...');
        const preCapture = await this.screenshotService.captureFullScreenBackground();
        this.preCaptureScreenshot = preCapture;
        console.log('Pre-capture completed, creating overlay...');
        
        // Step 5: Show overlay for selection
        await this.startScreenCaptureWithoutPreCapture();
        
        // Mark that we've used capture successfully (for future runs)
        this.hasUsedCaptureSuccessfully = true;
        
      } catch (error) {
        console.error('Error in smart capture sequence:', error);
        // On error, restore the main window
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.show();
          this.mainWindow.focus();
        }
      }
    });
  }

  setupIpcHandlers() {
    ipcMain.handle('start-capture', async () => {
      return await this.startScreenCapture();
    });

    ipcMain.handle('capture-area', async (event, bounds) => {
      return await this.captureSelectedArea(bounds);
    });

    ipcMain.handle('capture-selected-area', async (event, bounds) => {
      return await this.captureSelectedArea(bounds);
    });

    ipcMain.handle('close-capture-overlay', () => {
      if (this.captureWindow) {
        this.captureWindow.close();
        this.captureWindow = null;
      }
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
      return await this.translationService.getSupportedLanguages();
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

    ipcMain.handle('create-translated-image', async (event, { originalImagePath, originalText, translatedText, textBlocks }) => {
      try {
        const translatedImagePath = await this.screenshotService.createImageWithTranslation(
          originalImagePath, 
          originalText, 
          translatedText, 
          textBlocks
        );
        return { success: true, imagePath: translatedImagePath };
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
  }

  async startScreenCapture() {
    try {
      // If capture window already exists, close it first
      if (this.captureWindow) {
        this.captureWindow.close();
        this.captureWindow = null;
      }

      // If this is called from the UI (not global shortcut), take pre-capture here
      if (!this.preCaptureScreenshot) {
        console.log('Taking pre-capture screenshot of current screen state...');
        const preCapture = await this.screenshotService.captureFullScreen();
        this.preCaptureScreenshot = preCapture;
      }
      
      // Minimize main window to prevent interference with global capture
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.minimize();
      }

      // Small delay to ensure any existing window is fully closed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create the transparent overlay for global area selection
      this.createCaptureOverlay();
      
      return { success: true };
    } catch (error) {
      console.error('Error starting screen capture:', error);
      return { success: false, error: error.message };
    }
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

  async checkScreenPermissions() {
    try {
      if (process.platform === 'darwin') {
        console.log('Checking macOS screen recording permissions...');
        
        // Check if we have screen recording permission
        const hasPermission = systemPreferences.getMediaAccessStatus('screen');
        console.log('Screen recording permission status:', hasPermission);
        
        if (hasPermission !== 'granted') {
          console.log('Screen recording permission not granted, requesting...');
          
          // Show dialog to user about permissions
          const result = await dialog.showMessageBox(this.mainWindow, {
            type: 'warning',
            title: 'Screen Recording Permission Required',
            message: 'G-Pad AI needs screen recording permission to capture screenshots from other applications.',
            detail: 'Please grant permission in System Preferences > Security & Privacy > Privacy > Screen Recording, then restart the app.',
            buttons: ['Open System Preferences', 'Cancel'],
            defaultId: 0
          });
          
          if (result.response === 0) {
            // Open System Preferences
            const { exec } = require('child_process');
            exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"');
          }
          
          return false;
        }
        
        // Even if permission is granted, on first use macOS might still show a system dialog
        if (hasPermission === 'granted' && !this.hasUsedCaptureSuccessfully) {
          console.log('Permission granted, but first use may trigger system dialog');
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
}

new App(); 