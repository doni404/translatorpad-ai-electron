const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Screenshot and capture
  startCapture: () => ipcRenderer.invoke('start-capture'),
  captureArea: (bounds) => ipcRenderer.invoke('capture-area', bounds),
  captureSelectedArea: (bounds) => ipcRenderer.invoke('capture-selected-area', bounds),
  closeCaptureOverlay: () => ipcRenderer.invoke('close-capture-overlay'),

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