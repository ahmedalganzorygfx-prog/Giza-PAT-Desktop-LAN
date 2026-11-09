'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const cfg = ipcRenderer.sendSync('get-config-sync') || {};
contextBridge.exposeInMainWorld('GIZA_SERVER_CONFIG', {
  serverUrl: cfg.serverUrl,
  token: cfg.token
});
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getDataDir: () => cfg.dataDir || '',
  getServerConfig: () => ({ serverUrl: cfg.serverUrl, token: cfg.token }),
  exportToFolder: data => ipcRenderer.invoke('export-backup', data),
  saveBackup: data => ipcRenderer.invoke('save-backup', data),
  loadBackup: () => ipcRenderer.invoke('load-backup'),
  openDataDir: () => ipcRenderer.invoke('open-data-dir'),
  onBackupRequest: callback => ipcRenderer.on('backup-request', () => callback()),
  saveConfig: next => ipcRenderer.invoke('save-config', next),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  getConfig: () => ({ ...cfg })
});
