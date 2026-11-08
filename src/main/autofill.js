// Passwords + form autofill: the link between web pages (src/preload/tab.js) and the encrypted store.
// Rules:
//  • The site ("origin") always comes from the frame that sent the message — a page can't claim to be another site.
//  • A password is only handed to the site it was saved for, and only when you click an account (in-page chooser).
//  • Nothing is saved without asking; InPrivate windows never save.
const { ipcMain } = require('electron');
const settings = require('./settings');
const passwords = require('./passwords');
const { Tab } = require('./tab');

const webOrigin = (frame) => {
  try { const o = frame.origin; return /^https?:\/\//.test(o) ? o : null; } catch { return null; }
};

function from(e) {
  const tab = Tab.fromWebContents(e.sender);
  const origin = e.senderFrame ? webOrigin(e.senderFrame) : null;
  return tab && origin ? { tab, win: tab.win, origin } : null;
}

const label = (p) => [p.name || [p['given-name'], p['family-name']].filter(Boolean).join(' '), p.email || p['street-address']].filter(Boolean).join(' — ') || 'Saved address';

function register(hub) {
  // What can this page be offered? (usernames only — never passwords)
  ipcMain.handle('af:query', async (e) => {
    const ctx = from(e);
    if (!ctx) return null;
    const out = { accounts: [], profiles: [] };
    if (settings.get('autofillPasswords')) out.accounts = passwords.forOrigin(ctx.origin).map(({ id, username }) => ({ id, username }));
    if (settings.get('autofillForms')) out.profiles = (await passwords.profiles()).map((p) => ({ id: p.id, label: label(p) }));
    return out;
  });

  // You clicked an account in the page's chooser → its password, for this same site only.
  ipcMain.handle('af:fill-password', async (e, id) => {
    const ctx = from(e);
    if (!ctx || !settings.get('autofillPasswords')) return null;
    const account = passwords.forOrigin(ctx.origin).find((a) => a.id === Number(id));
    if (!account) return null;
    const password = await passwords.password(account.id, { origin: ctx.origin });
    if (password == null) return null;
    passwords.markUsed(account.id);
    return { username: account.username, password };
  });

  ipcMain.handle('af:profile', async (e, id) => {
    const ctx = from(e);
    if (!ctx || !settings.get('autofillForms')) return null;
    return passwords.profile(id);
  });

  // A login form was submitted → offer to save (unless known, refused for this site, private, or turned off).
  ipcMain.on('af:submitted-login', async (e, data) => {
    const ctx = from(e);
    if (!ctx || ctx.win.private || !settings.get('offerSavePasswords')) return;
    const username = String(data?.username || '').slice(0, 300);
    const password = String(data?.password || '');
    if (!password || password.length > 1000 || passwords.never.has(ctx.origin)) return;
    if (!(await passwords.available())) return;
    if (await passwords.isKnown({ origin: ctx.origin, username, password })) return;
    const updating = passwords.forOrigin(ctx.origin).some((a) => a.username === username);
    ctx.win.pendingSave = { type: 'password', origin: ctx.origin, username, password, updating };
    ctx.win.sendUI('save-prompt', { type: 'password', origin: ctx.origin, username, updating });
  });

  ipcMain.on('af:submitted-form', async (e, data) => {
    const ctx = from(e);
    if (!ctx || ctx.win.private || !settings.get('autofillForms')) return;
    const clean = {};
    for (const k of passwords.FORM_FIELDS) if (typeof data?.[k] === 'string' && data[k].trim()) clean[k] = data[k].trim().slice(0, 200);
    if (Object.keys(clean).length < 2) return;
    const existing = await passwords.profiles();
    if (existing.some((p) => Object.entries(clean).every(([k, v]) => p[k] === v))) return; // nothing new
    ctx.win.pendingSave = { type: 'form', data: clean };
    ctx.win.sendUI('save-prompt', { type: 'form', summary: label(clean) });
  });

  // A site asked for a passkey (we made it fail fast) → explain what to do.
  ipcMain.on('af:passkey-blocked', (e) => {
    const ctx = from(e);
    if (!ctx) return;
    ctx.win.showToast('This site asked for a passkey. Passkeys aren’t supported in Rove yet — choose “Try another way” or sign in with your password.');
  });

  // Answer from the toolbar's save popup.
  ipcMain.on('save-prompt:answer', async (e, { action, username } = {}) => {
    const win = hub.fromChrome(e.sender);
    const pending = win?.pendingSave;
    if (!pending) return;
    win.pendingSave = null;
    try {
      if (pending.type === 'password') {
        if (action === 'save') await passwords.save({ origin: pending.origin, username: username ?? pending.username, password: pending.password });
        if (action === 'never') passwords.never.add(pending.origin);
      } else if (pending.type === 'form' && action === 'save') {
        await passwords.saveProfile(pending.data);
      }
    } catch (err) { console.error('Saving failed:', err.message); }
    win.sendUI('save-prompt', null);
  });
}

module.exports = { register };
