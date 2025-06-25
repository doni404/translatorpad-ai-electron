const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Screenshot and capture
  startCapture: () => ipcRenderer.invoke('start-capture'),
  captureArea: (bounds) => ipcRenderer.invoke('capture-area', bounds),
  closeCaptureOverlay: () => ipcRenderer.invoke('close-capture-overlay'),
  captureLupArea: () => ipcRenderer.invoke('capture-lup-area'),
  resetLupCapture: () => ipcRenderer.invoke('reset-lup-capture'),
  openInApp: () => ipcRenderer.invoke('open-in-app'),

  // Vision and translation APIs
  extractAndTranslate: (data) => ipcRenderer.invoke('extract-and-translate', data),
  getLanguages: () => ipcRenderer.invoke('get-languages'),

  // File operations
  saveResult: (data) => ipcRenderer.invoke('save-result', data),
  createTranslatedImage: (data) => ipcRenderer.invoke('create-translated-image', data),

  // Event listeners
  onCaptureComplete: (callback) => {
    ipcRenderer.on('capture-complete', (event, result) => {
      callback(result);
    });
  },

  onLupResult: (callback) => {
    ipcRenderer.on('lup-result', (event, imagePath) => {
      callback(imagePath);
    });
  },

  // Lup result data listener
  onLupResultData: (callback) => {
    ipcRenderer.on('lup-result-data', (event, resultData) => {
      callback(resultData);
    });
  },

  // Original image data listener
  onOriginalImageData: (callback) => {
    ipcRenderer.on('original-image-data', (event, originalImageDataUrl) => {
      callback(originalImageDataUrl);
    });
  },

  // Clipboard operations
  copyAsImage: (imageDataUrl) => ipcRenderer.invoke('copy-as-image', imageDataUrl),
  copyAsText: (text) => ipcRenderer.invoke('copy-as-text', text),

  // Target language change listener
  onTargetLanguageChanged: (callback) => {
    ipcRenderer.on('target-language-changed', (event, language) => {
      callback(language);
    });
  },

  // Trigger capture listener
  onTriggerCapture: (callback) => {
    ipcRenderer.on('trigger-capture', (event) => {
      callback();
    });
  },

  // Toast message listener
  onShowToast: (callback) => {
    ipcRenderer.on('show-toast', (event, data) => {
      callback(data);
    });
  },

  // Remove listeners
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners();
  }
}); 