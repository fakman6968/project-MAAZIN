const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('maazin', {
  signIn: (email, password) => ipcRenderer.invoke('auth:signIn', email, password),
  user: () => ipcRenderer.invoke('auth:user'),
  copyConsent: () => ipcRenderer.invoke('consent:copy'),
  openMeeting: (id) => ipcRenderer.invoke('web:open', id),
  setRecording: (on) => ipcRenderer.invoke('tray:recording', on),
  save: (meeting) => ipcRenderer.invoke('meeting:save', meeting),
});
