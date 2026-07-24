const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    saveCredentials: (json) => ipcRenderer.invoke('auth:save-credentials', json),
    onSuccess: (cb) => ipcRenderer.on('auth:success', cb),
    onExpired: (cb) => ipcRenderer.on('auth:expired', cb)
  },
  calendar: {
    events: (params) => ipcRenderer.invoke('calendar:events', params),
    createEvent: (event) => ipcRenderer.invoke('calendar:create-event', event),
    calendars: () => ipcRenderer.invoke('calendar:calendars')
  },
  todos: {
    get: () => ipcRenderer.invoke('todos:get'),
    set: (todos) => ipcRenderer.invoke('todos:set', todos)
  },
  window: {
    fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
    isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen'),
    openExternal: (url) => ipcRenderer.invoke('window:open-external', url)
  }
});
