// Bridge between the browser UI (renderer) and main process.
const { contextBridge, ipcRenderer } = require('electron');

const LISTEN = ['remote-status', 'cursor', 'navigate', 'command', 'open-tab', 'downloads'];

contextBridge.exposeInMainWorld('bridge', {
  // renderer -> main
  viewSize: (w, h) => ipcRenderer.send('view-size', { w, h }),
  activeTab: (webContentsId) => ipcRenderer.send('active-tab', webContentsId),
  tabsUpdate: (list) => ipcRenderer.send('tabs-update', list),
  favoritesUpdate: (list) => ipcRenderer.send('favorites-update', list),
  downloadAction: (id, action) => ipcRenderer.send('download-action', { id, action }),
  downloadsGet: () => ipcRenderer.send('downloads-get'),
  // Show a native menu; resolves to the chosen item's id (or null).
  popupMenu: (items) => ipcRenderer.invoke('popup-menu', items),
  // main -> renderer
  on: (channel, fn) => {
    if (LISTEN.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
