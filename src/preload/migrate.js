// Reads the old version's data out of file:// localStorage and hands it to the main process (one time).
const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  ipcRenderer.send('migrate:data', {
    favorites: read('favorites'),
    history: read('history'),
    closeHistory: read('closeHistory'),
    favbar: read('favbar'),
  });
});
