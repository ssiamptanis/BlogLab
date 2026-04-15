'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronApp', {
  version:  process.env.npm_package_version || '1.0.0',
  platform: process.platform,
  // Ask the main process to show a Save dialog and write the PDF to disk
  savePDF: (base64, filename) => ipcRenderer.invoke('save-pdf', { base64, filename }),
  // Auto-updater
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, data) => cb(data)),
  installUpdate:  ()   => ipcRenderer.send('install-update'),
})
