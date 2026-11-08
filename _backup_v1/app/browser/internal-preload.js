// Runs in every tab, but only our own built-in pages (history, new tab) get the channel.
// Web pages get nothing from here.
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED = ['/browser/history.html', '/browser/newtab.html'];
const ours = location.protocol === 'file:' &&
  ALLOWED.some((p) => decodeURIComponent(location.pathname).endsWith(p));

if (ours) {
  contextBridge.exposeInMainWorld('internal', {
    send: (type, data) => ipcRenderer.sendToHost('internal', type, data),
    on: (fn) => ipcRenderer.on('internal', (_e, type, data) => fn(type, data)),
  });
}
