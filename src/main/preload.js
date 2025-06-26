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
  extractAndTranslate: async (options) => ipcRenderer.invoke('extract-and-translate', options),
  getLanguages: async () => ipcRenderer.invoke('get-languages'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Shortcuts Management
  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  setShortcuts: (shortcuts) => ipcRenderer.invoke('set-shortcuts', shortcuts),
  resetShortcuts: () => ipcRenderer.invoke('reset-shortcuts'),
  setShortcutsRecording: (isRecording) => ipcRenderer.invoke('set-shortcuts-recording', isRecording),
  
  // Language Management
  getTargetLanguage: () => ipcRenderer.invoke('get-target-language'),
  setTargetLanguage: (language) => ipcRenderer.invoke('set-target-language', language),

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

  // Gallery update listener
  onGalleryUpdate: (callback) => {
    ipcRenderer.on('gallery-update', (event, galleryData) => {
      callback(galleryData);
    });
  },

  // Gallery item removal
  removeFromGallery: (index) => ipcRenderer.invoke('remove-from-gallery', index),

  // Clipboard operations
  copyAsImage: (imageDataUrl) => ipcRenderer.invoke('copy-as-image', imageDataUrl),
  copyAsText: (text) => ipcRenderer.invoke('copy-as-text', text),

  // History copy operations
  getOriginalImageForCopy: (imagePath) => ipcRenderer.invoke('get-original-image-for-copy', imagePath),
  getImageAsDataUrl: (imagePath) => ipcRenderer.invoke('get-image-as-data-url', imagePath),

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
  },

  // New function
  openExternalLink: (url) => ipcRenderer.send('open-external-link', url),

  // New listener
  onResetToHome: (callback) => {
    ipcRenderer.on('reset-to-home', () => callback());
  },

  // --- New listener for About page ---
  onShowAboutPage: (callback) => {
    ipcRenderer.on('show-about-page', () => callback());
  },

  // New listener for Clear History
  onClearHistory: (callback) => {
    ipcRenderer.on('clear-history', () => callback());
  },

  // Gallery Operations
  copyFromGallery: (args) => ipcRenderer.invoke('copy-from-gallery', args),

  // Dialogs
  showClearHistoryDialog: () => ipcRenderer.invoke('show-clear-history-dialog'),

  // External Links
  openExternalLink: (url) => ipcRenderer.send('open-external-link', url),

  // Gallery Management
  resizeGalleryWindow: (size) => ipcRenderer.invoke('resize-gallery-window', size),

  // Loading step updates
  onUpdateLoadingStep: (callback) => {
    ipcRenderer.on('update-loading-step', (event, stepText) => {
      callback(stepText);
    });
  }
}); 