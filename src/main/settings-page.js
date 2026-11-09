// What pb://settings can ask for. (Registered as the page API for "settings"; see ipc.js.)
const { dialog, session, systemPreferences, clipboard } = require('electron');
const settings = require('./settings');
const urls = require('./urls');
const history = require('./history');
const downloads = require('./downloads');
const closed = require('./closed');
const passwords = require('./passwords');
const updates = require('./updates');

// Showing a saved password needs your fingerprint on Macs with Touch ID; elsewhere an explicit confirmation
// (Electron has no Windows Hello / Linux password prompt).
const unlockedUntil = new WeakMap(); // window → time
async function authenticate(win, reason) {
  if ((unlockedUntil.get(win) || 0) > Date.now()) return true;
  let ok = false;
  if (process.env.PB_TEST) ok = process.env.PB_TEST_AUTH !== 'deny';
  else if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
    try { await systemPreferences.promptTouchID(reason); ok = true; } catch { ok = false; }
  } else {
    const { response } = await dialog.showMessageBox(win.base, { type: 'warning', buttons: ['Show', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Show saved passwords?',
      detail: process.platform === 'darwin' ? 'This Mac has no Touch ID, so passwords will be shown after this confirmation only.'
        : 'Anyone using this computer account can see them after this confirmation. Lock your computer when you step away.' });
    ok = response === 0;
  }
  if (ok) unlockedUntil.set(win, Date.now() + 60_000); // one unlock lasts a minute
  return ok;
}

async function clearBrowsingData({ history: h, cookies, cache, downloads: dl, closedTabs } = {}) {
  const ses = session.defaultSession;
  const jobs = [];
  if (h) history.clear();
  if (cookies) jobs.push(ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache'] }));
  if (cache) jobs.push(ses.clearCache(), ses.clearCodeCaches({}));
  if (dl) downloads.action(null, 'clear');
  if (closedTabs) { while (closed.shared.pop()) { /* empty the stack */ } }
  await Promise.all(jobs);
  return true;
}

function api(hub) {
  return {
    get: async () => ({
      settings: settings.all(),
      engines: Object.entries(urls.ENGINES).map(([id, e]) => ({ id, name: e.name })),
      downloadsFolder: downloads.folder(),
      about: updates.state(),
      encryption: await passwords.available(),
    }),
    set: (_ctx, patch) => { settings.set(patch || {}); return settings.all(); },
    reset: (_ctx, key) => { settings.reset(String(key)); return settings.all(); },
    chooseDownloadDir: async (ctx) => {
      const r = await dialog.showOpenDialog(ctx.win.base, { properties: ['openDirectory', 'createDirectory'], defaultPath: downloads.folder() });
      if (!r.canceled && r.filePaths[0]) settings.set({ downloadDir: r.filePaths[0] });
      return downloads.folder();
    },
    clearData: (_ctx, what) => clearBrowsingData(what || {}),
    checkUpdates: () => updates.check(),
    runUpdate: () => updates.runUpdate(),
    openPage: (ctx, page) => { if (['history'].includes(page)) hub.openInternal(page, ctx.win); },

    // passwords
    passwords: async () => ({ items: passwords.list(), never: passwords.never.list(), encryption: await passwords.available() }),
    revealPassword: async (ctx, id) => ((await authenticate(ctx.win, 'show a saved password')) ? passwords.password(id) : null),
    copyPassword: async (ctx, id) => {
      if (!(await authenticate(ctx.win, 'copy a saved password'))) return false;
      const pw = await passwords.password(id);
      if (pw == null) return false;
      clipboard.writeText(pw);
      setTimeout(() => { if (clipboard.readText() === pw) clipboard.clear(); }, 60_000); // don't leave it there forever
      return true;
    },
    updatePassword: async (ctx, { id, username, password } = {}) => {
      if (password && !(await authenticate(ctx.win, 'change a saved password'))) return false;
      return passwords.update(id, { username, password });
    },
    deletePassword: (_ctx, id) => passwords.remove(id),
    removeNever: (_ctx, origin) => passwords.never.remove(origin),

    // phone remote
    remote: () => require('./remote').info(),
    remoteForgetDevice: (_ctx, id) => require('./remote').forgetDevice(String(id)),
    remoteNewLink: () => require('./remote').newLink(),

    // form data
    profiles: () => passwords.profiles(),
    saveProfile: (_ctx, { id, ...data } = {}) => (id ? passwords.updateProfile(id, data) : passwords.saveProfile(data)),
    deleteProfile: (_ctx, id) => passwords.removeProfile(id),
  };
}

module.exports = { api, clearBrowsingData, authenticate };
