const { app, BrowserWindow, ipcMain, globalShortcut, screen, desktopCapturer, dialog } = require('electron');
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
    
    this.init();
  }

  init() {
    app.whenReady().then(() => {
      this.createMainWindow();
      this.registerShortcuts();
      this.setupIpcHandlers();
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
    // Get all displays to handle multi-monitor setups
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();
    
    // Store display info for coordinate conversion
    this.displayInfo = {
      bounds: primaryDisplay.bounds,
      scaleFactor: primaryDisplay.scaleFactor || 1,
      workArea: primaryDisplay.workArea
    };
    
    console.log('Creating capture overlay with display info:', this.displayInfo);
    
    this.captureWindow = new BrowserWindow({
      x: primaryDisplay.bounds.x,
      y: primaryDisplay.bounds.y,
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

    // Create capture overlay HTML content directly
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
            }
            .instructions {
                position: absolute;
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
                to { stroke-dashoffset: -10px; }
            }
            .corner-handle {
                position: absolute;
                width: 10px;
                height: 10px;
                background: #007AFF;
                border: 2px solid white;
                border-radius: 50%;
            }
            .corner-handle.top-left { top: -5px; left: -5px; }
            .corner-handle.top-right { top: -5px; right: -5px; }
            .corner-handle.bottom-left { bottom: -5px; left: -5px; }
            .corner-handle.bottom-right { bottom: -5px; right: -5px; }
            .dimensions {
                position: absolute;
                top: -30px;
                left: 0;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                font-family: monospace;
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
            
            // Get device pixel ratio for proper scaling
            const devicePixelRatio = window.devicePixelRatio || 1;
            
            document.addEventListener('mousedown', (e) => {
                isSelecting = true;
                startX = e.clientX;
                startY = e.clientY;
                selectionBox.style.display = 'block';
                selectionBox.style.left = startX + 'px';
                selectionBox.style.top = startY + 'px';
                selectionBox.style.width = '0px';
                selectionBox.style.height = '0px';
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
                
                dimensions.textContent = Math.round(width * devicePixelRatio) + ' × ' + Math.round(height * devicePixelRatio);
            });
            
            document.addEventListener('mouseup', (e) => {
                if (!isSelecting) return;
                
                const currentX = e.clientX;
                const currentY = e.clientY;
                
                const left = Math.min(startX, currentX);
                const top = Math.min(startY, currentY);
                const width = Math.abs(currentX - startX);
                const height = Math.abs(currentY - startY);
                
                if (width > 10 && height > 10) {
                    // Get actual window size for more accurate coordinate conversion
                    const windowWidth = window.innerWidth;
                    const windowHeight = window.innerHeight;
                    
                    // Apply device pixel ratio for proper coordinate conversion
                    // Also account for potential display scaling differences
                    const actualDevicePixelRatio = window.devicePixelRatio || 1;
                    
                    console.log('=== DETAILED COORDINATE ANALYSIS ===');
                    console.log('Overlay dimensions:', { windowWidth, windowHeight, devicePixelRatio: actualDevicePixelRatio });
                    console.log('Raw mouse coordinates:', { startX, startY, currentX, currentY });
                    console.log('Selection coordinates (overlay space):', { left, top, width, height });
                    console.log('Window position:', { screenX: window.screenX, screenY: window.screenY });
                    console.log('Window outer dimensions:', { outerWidth: window.outerWidth, outerHeight: window.outerHeight });
                    console.log('Screen available dimensions:', { 
                        availWidth: window.screen.availWidth, 
                        availHeight: window.screen.availHeight,
                        screenWidth: window.screen.width,
                        screenHeight: window.screen.height
                    });
                    console.log('Document dimensions:', {
                        documentWidth: document.documentElement.clientWidth,
                        documentHeight: document.documentElement.clientHeight,
                        bodyWidth: document.body.clientWidth,
                        bodyHeight: document.body.clientHeight
                    });
                    console.log('Viewport info:', {
                        visualViewportWidth: window.visualViewport ? window.visualViewport.width : 'not available',
                        visualViewportHeight: window.visualViewport ? window.visualViewport.height : 'not available',
                        pageXOffset: window.pageXOffset,
                        pageYOffset: window.pageYOffset
                    });
                    
                    const finalCoords = {
                        x: Math.round(left * actualDevicePixelRatio),
                        y: Math.round(top * actualDevicePixelRatio),
                        width: Math.round(width * actualDevicePixelRatio),
                        height: Math.round(height * actualDevicePixelRatio),
                        // Add window positioning data for dynamic offset calculation
                        windowX: window.screenX,
                        windowY: window.screenY,
                        windowWidth: windowWidth,
                        windowHeight: windowHeight,
                        // Additional debugging data
                        rawLeft: left,
                        rawTop: top,
                        scalingRatio: actualDevicePixelRatio,
                        overlayActualPosition: {
                            x: window.screenX,
                            y: window.screenY
                        }
                    };
                    
                    console.log('Final coordinates to be sent:', finalCoords);
                    console.log('Coordinate conversion check:');
                    console.log('  Raw overlay: (' + left + ', ' + top + ')');
                    console.log('  After scaling: (' + finalCoords.x + ', ' + finalCoords.y + ')');
                    console.log('  Scaling factor applied: ' + actualDevicePixelRatio);
                    console.log('=== END DETAILED ANALYSIS ===');
                    
                    window.electronAPI.captureSelectedArea(finalCoords);
                }
                
                window.electronAPI.closeCaptureOverlay();
            });
            
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    window.electronAPI.closeCaptureOverlay();
                }
            });
        </script>
    </body>
    </html>`;

    this.captureWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(captureHtml));
    
    this.captureWindow.on('closed', () => {
      this.captureWindow = null;
    });

    // Focus the capture window
    this.captureWindow.focus();
  }

  registerShortcuts() {
    globalShortcut.register('CommandOrControl+Shift+S', () => {
      this.startScreenCapture();
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
      // Create the transparent overlay for area selection
      this.createCaptureOverlay();
      return { success: true };
    } catch (error) {
      console.error('Error starting screen capture:', error);
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

      // Small delay to ensure overlay is closed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Capture the selected area
      console.log('Capturing area with bounds:', bounds);
      const imagePath = await this.screenshotService.captureArea(bounds);
      
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
      
      // Send result to main window
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
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
      
      // Send error to main window
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('capture-complete', {
          success: false,
          error: error.message
        });
      }
      
      return { success: false, error: error.message };
    }
  }
}

new App(); 