// Hex Cinema, inside embedded frames (video players from other sites): Rove's main process asks this frame to run
// Cinema's helper in its own isolated world — the same hidden helper it uses on the page itself. Pages can't
// send these requests (they come only from Rove's main process) and never see the helper.
const { ipcRenderer, webFrame } = require('electron');

const WORLD = 1077;
ipcRenderer.on('hex-cin:run', async (_e, id, code, gesture) => {
  try {
    const r = await webFrame.executeJavaScriptInIsolatedWorld(WORLD, [{ code: String(code) }], !!gesture);
    ipcRenderer.send('hex-cin:ret', id, { ok: true, r });
  } catch (err) {
    ipcRenderer.send('hex-cin:ret', id, { ok: false, e: String((err && err.message) || err) });
  }
});
