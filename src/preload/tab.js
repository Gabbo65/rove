// Runs in every tab, isolated from the page's own scripts.
// • Built-in pages (pb://newtab, history, settings, error) get the `pb` API. Web pages get nothing.
// • Web pages get password + form autofill: a chooser appears when you click a login/address field;
//   passwords are only requested after a real (trusted) click on an account.
const { contextBridge, ipcRenderer } = require('electron');

const INTERNAL = /^pb:\/\/(newtab|history|settings|error)(\/|$)/i;

if (INTERNAL.test(location.href) && window.top === window) {
  contextBridge.exposeInMainWorld('pb', {
    call: (name, ...args) => ipcRenderer.invoke('page', name, ...args),
    on: (fn) => {
      const handler = (_e, name, data) => fn(name, data);
      ipcRenderer.on('pb:event', handler);
      return () => ipcRenderer.removeListener('pb:event', handler);
    },
  });
} else if (/^https?:$/.test(location.protocol)) {
  blockPasskeys();
  setupAutofill();
}

// Passkeys (WebAuthn) need Chromium parts that Electron doesn't ship, so a request would just hang forever.
// Instead: tell sites passkeys aren't available (they then offer the password first), make any request fail
// immediately the way a cancelled request does (sites then show "Try another way"), and show a notice.
function blockPasskeys() {
  try {
    contextBridge.executeInMainWorld({
      func: () => {
        const c = navigator.credentials;
        if (!c || c.__pbPatched) return;
        const notAllowed = () => new DOMException('Passkeys are not supported in this browser yet.', 'NotAllowedError');
        const tell = () => document.dispatchEvent(new CustomEvent('pb-passkey-blocked'));
        const origGet = c.get.bind(c), origCreate = c.create.bind(c);
        const pending = (opts) => new Promise((_, reject) => {
          // Background passkey autofill ("conditional"): stays quiet until the site cancels it.
          opts?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
        Object.defineProperty(c, 'get', { value: function get(opts) {
          if (opts && opts.publicKey) { if (opts.mediation === 'conditional') return pending(opts); tell(); return Promise.reject(notAllowed()); }
          return origGet(opts);
        }, configurable: true, writable: true });
        Object.defineProperty(c, 'create', { value: function create(opts) {
          if (opts && opts.publicKey) { tell(); return Promise.reject(notAllowed()); }
          return origCreate(opts);
        }, configurable: true, writable: true });
        Object.defineProperty(c, '__pbPatched', { value: true });
        const P = window.PublicKeyCredential;
        if (P) {
          P.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
          P.isConditionalMediationAvailable = () => Promise.resolve(false);
          if (P.getClientCapabilities) P.getClientCapabilities = () => Promise.resolve({ conditionalGet: false, conditionalCreate: false,
            hybridTransport: false, passkeyPlatformAuthenticator: false, userVerifyingPlatformAuthenticator: false });
        }
      },
    });
  } catch {}
  let last = 0;
  document.addEventListener('pb-passkey-blocked', () => {
    if (Date.now() - last < 4000) return;
    last = Date.now();
    ipcRenderer.send('af:passkey-blocked');
  });
}

function setupAutofill() {
  // ---------- field detection ----------
  const TEXTY = new Set(['text', 'email', 'tel', 'url', 'search', '']);
  const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const isPassword = (el) => el instanceof HTMLInputElement && el.type === 'password';
  const isTexty = (el) => el instanceof HTMLInputElement && TEXTY.has(el.type) && !el.readOnly && !el.disabled;
  const scope = (el) => el.form || el.closest('form') || document;

  function usernameFor(pw) {
    const all = [...scope(pw).querySelectorAll('input')].filter((i) => isVisible(i) || i === pw);
    const before = all.slice(0, all.indexOf(pw)).filter(isTexty);
    return before.reverse().find((i) => /username|email/.test(i.autocomplete) || /user|login|email|account|id/i.test(i.name + i.id))
      || before[0] || null;
  }

  const FORM_RULES = [
    ['email', (i, h) => i.type === 'email' || /e-?mail/.test(h)],
    ['tel', (i, h) => i.type === 'tel' || /phone|tel|mobile|cell/.test(h)],
    ['given-name', (i, h) => /first.?name|fname|given/.test(h)],
    ['family-name', (i, h) => /last.?name|lname|surname|family/.test(h)],
    ['name', (i, h) => /(^|[^a-z])(full.?name|your.?name|name)($|[^a-z])/.test(h) && !/user|company|org|file/.test(h)],
    ['organization', (i, h) => /company|organi[sz]ation|business/.test(h)],
    ['postal-code', (i, h) => /zip|postal|post.?code/.test(h)],
    ['address-level2', (i, h) => /city|town|locality/.test(h)],
    ['address-level1', (i, h) => /state|province|region|county/.test(h)],
    ['country', (i, h) => /country/.test(h)],
    ['street-address', (i, h) => /address|street|addr/.test(h) && !/mail/.test(h)],
  ];
  const AC_MAP = { 'address-line1': 'street-address', 'address-line2': null, 'country-name': 'country' };
  function fieldKind(el) {
    if (!isTexty(el) && !(el instanceof HTMLSelectElement)) return null;
    const ac = (el.autocomplete || '').split(/\s+/).pop();
    if (ac in AC_MAP) return AC_MAP[ac];
    if (FORM_RULES.some(([k]) => k === ac)) return ac;
    if (/off|username|current-password|new-password|one-time-code|cc-/.test(ac)) return null;
    const hint = `${el.name} ${el.id} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
    for (const [kind, test] of FORM_RULES) if (test(el, hint)) return kind;
    return null;
  }

  // React/Vue-safe value setting
  const setValue = (el, value) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // ---------- what's saved for this site ----------
  let offer = null;
  let asking = null;
  const query = () => {
    if (!asking) asking = ipcRenderer.invoke('af:query').then((r) => { offer = r || { accounts: [], profiles: [] }; return offer; }).catch(() => ({ accounts: [], profiles: [] }));
    return asking;
  };

  // ---------- the chooser (closed shadow root: the page can't read or click into it) ----------
  let host = null, shadow = null, list = null, current = null;
  function chooser() {
    if (host) return;
    host = document.createElement('pb-autofill');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; display: none;';
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      .box { font: 13px -apple-system, system-ui, sans-serif; background: #fff; color: #1b1b1f; border-radius: 10px; min-width: 240px; max-width: 360px;
        box-shadow: 0 8px 28px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.08); padding: 4px; }
      @media (prefers-color-scheme: dark) { .box { background: #2c2c2c; color: #f0f0f0; } .row:hover { background: rgba(255,255,255,.08); } }
      .head { color: #8a8a90; font-size: 11px; padding: 6px 10px 4px; }
      .row { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 7px; cursor: default; }
      .row:hover { background: rgba(0,0,0,.06); }
      .k { width: 18px; text-align: center; opacity: .7; }
      .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .s { color: #8a8a90; font-size: 11px; }
    </style><div class="box"><div class="head"></div><div class="list"></div></div>`;
    list = shadow.querySelector('.list');
    document.documentElement.append(host);
  }
  function hide() { if (host) host.style.display = 'none'; current = null; }
  function show(field, head, entries, onPick) {
    chooser();
    shadow.querySelector('.head').textContent = head;
    list.replaceChildren(...entries.map((en) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<span class="k"></span><div><div class="t"></div><div class="s"></div></div>';
      row.querySelector('.k').textContent = en.icon;
      row.querySelector('.t').textContent = en.title;
      row.querySelector('.s').textContent = en.sub || '';
      row.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the field
      row.addEventListener('click', (e) => { if (e.isTrusted) { hide(); onPick(en); } });
      return row;
    }));
    const r = field.getBoundingClientRect();
    host.style.left = `${Math.max(4, Math.min(r.left, innerWidth - 260))}px`;
    host.style.top = `${r.bottom + 4}px`;
    host.style.display = 'block';
    current = field;
  }

  // ---------- filling ----------
  async function fillAccount(field, id) {
    const res = await ipcRenderer.invoke('af:fill-password', id);
    if (!res) return;
    const pw = isPassword(field) ? field : [...scope(field).querySelectorAll('input[type=password]')].find(isVisible);
    const user = pw ? usernameFor(pw) : field;
    if (user && res.username) setValue(user, res.username);
    if (pw) setValue(pw, res.password);
    lastReported = `${res.username}\n${res.password}`; // filled by us: no "save?" for the same thing
  }
  async function fillProfile(field, id) {
    const data = await ipcRenderer.invoke('af:profile', id);
    if (!data) return;
    for (const el of scope(field).querySelectorAll('input, select')) {
      const kind = fieldKind(el);
      if (!kind || !isVisible(el)) continue;
      let v = data[kind];
      if (!v && kind === 'name') v = [data['given-name'], data['family-name']].filter(Boolean).join(' ');
      if (!v && kind === 'given-name' && data.name) v = data.name.split(' ')[0];
      if (!v && kind === 'family-name' && data.name) v = data.name.split(' ').slice(1).join(' ');
      if (v && !el.value) setValue(el, v);
    }
  }

  // ---------- show the chooser when you click into a field ----------
  document.addEventListener('focusin', async (e) => {
    const el = e.target;
    if (!e.isTrusted || !(el instanceof HTMLInputElement)) return;
    const pwField = isPassword(el) ? el : null;
    const loginUser = !pwField && isTexty(el) && [...scope(el).querySelectorAll('input[type=password]')].some((p) => usernameFor(p) === el);
    const kind = fieldKind(el);
    if (!pwField && !loginUser && !kind) return;
    const o = await query();
    if (document.activeElement !== el) return;
    if ((pwField || loginUser) && o.accounts.length) {
      show(el, 'Saved passwords for this site', o.accounts.map((a) => ({ id: a.id, icon: '🔑', title: a.username || '(no username)', sub: '••••••••' })),
        (en) => fillAccount(el, en.id));
    } else if (kind && !el.value && o.profiles.length) {
      show(el, 'Fill with a saved address', o.profiles.map((p) => ({ id: p.id, icon: '👤', title: p.label })), (en) => fillProfile(el, en.id));
    }
  }, true);
  document.addEventListener('focusout', (e) => { if (e.target === current) setTimeout(hide, 150); }, true);
  window.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }, true);

  // ---------- noticing a submitted login / address form ----------
  let lastReported = '';
  function report(root) {
    const pws = [...root.querySelectorAll('input[type=password]')].filter((p) => p.value);
    if (pws.length) {
      // sign-up / change-password forms: the new password is the one to keep
      const pw = pws.find((p) => p.autocomplete === 'new-password') || pws[pws.length - 1];
      const user = usernameFor(pw);
      const key = `${user?.value || ''}\n${pw.value}`;
      if (key === lastReported) return;
      lastReported = key;
      ipcRenderer.send('af:submitted-login', { username: user?.value || '', password: pw.value });
      return;
    }
    const data = {};
    for (const el of root.querySelectorAll('input, select')) {
      const kind = fieldKind(el);
      if (kind && el.value && !data[kind]) data[kind] = el.value;
    }
    if (Object.keys(data).length >= 3) {
      const key = JSON.stringify(data);
      if (key === lastReported) return;
      lastReported = key;
      ipcRenderer.send('af:submitted-form', data);
    }
  }
  document.addEventListener('submit', (e) => { if (e.target instanceof HTMLFormElement) report(e.target); }, true);
  // Sites that sign in with a script instead of a real form submit: the click on the button.
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const btn = e.target.closest?.('button, input[type=submit], input[type=button], [role=button]');
    if (!btn) return;
    const root = scope(btn);
    if (root.querySelector('input[type=password]')) setTimeout(() => report(root), 0);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.isTrusted && e.key === 'Enter' && isPassword(e.target)) setTimeout(() => report(scope(e.target)), 0);
  }, true);
}
