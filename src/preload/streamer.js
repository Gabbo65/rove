// Bridge for the hidden streamer page (phone mirror video).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('streamer', {
  signal: (clientId, msg) => ipcRenderer.send('streamer:signal', clientId, msg),
  on: (channel, fn) => {
    if (!['streamer:signal', 'streamer:close'].includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
