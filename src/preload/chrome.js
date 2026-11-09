// Bridge for the browser UI views (toolbar "chrome" + hud). Only listed channels pass.
const { contextBridge, ipcRenderer } = require('electron');

const SEND = new Set([
  'ui:content-rect', 'ui:overlay', 'ui:focus-page', 'hud:size', 'hud:toast-close',
  'tab:new', 'tab:activate', 'tab:close', 'tab:close-others', 'tab:close-right', 'tab:move', 'tab:pin',
  'tab:sleep', 'tab:duplicate', 'tab:reload', 'tab:reopen', 'tab:reopen-action',
  'nav', 'navigate', 'find', 'find:close', 'qr:toggle',
  'fav:remove', 'fav:reorder', 'fav:open', 'history:open-page', 'downloads:action', 'settings:set', 'settings:open', 'omnibox:delete', 'save-prompt:answer', 'win:new', 'update:open',
]);
const INVOKE = new Set(['fav:add-current', 'fav:update', 'history:recent', 'menu:popup', 'omnibox:local', 'omnibox:remote', 'tabs:search-data']);
const LISTEN = new Set([
  'state', 'favorites', 'downloads', 'settings', 'remote-status', 'command', 'hud:state',
  'qr-visible', 'fullscreen', 'page-fullscreen', 'update', 'save-prompt',
]);

// Only our own UI pages get the bridge — never a web page, even if one ended up in a UI view.
const OWN_UI = /^pb:\/\/(chrome|hud)\//i.test(location.href) && window.top === window;

// Nothing dropped on the UI may load in it (Chromium's default for a dropped link or file is to open it).
window.addEventListener('dragover', (e) => e.preventDefault(), true);
window.addEventListener('drop', (e) => e.preventDefault(), true);

if (OWN_UI) platformLabels();

if (OWN_UI) contextBridge.exposeInMainWorld('pb', {
  send(channel, ...args) { if (SEND.has(channel)) ipcRenderer.send(channel, ...args); },
  invoke(channel, ...args) { return INVOKE.has(channel) ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error('blocked')); },
  on(channel, fn) {
    if (!LISTEN.has(channel)) return () => {};
    const handler = (_e, data) => fn(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});

// Shortcut labels are written Mac-style (⇧⌘T); on Windows / Linux show them as Ctrl+Shift+T.
// Also tags <html> with the system (os-darwin / os-win32 / os-linux) for platform styling.
function platformLabels() {
  const os = process.platform;
  const tag = () => document.documentElement?.classList.add(`os-${os}`);
  if (document.documentElement) tag(); else document.addEventListener('readystatechange', tag, { once: true });
  if (os === 'darwin') return;
  const NAMES = { '⌃': 'Ctrl', '⌘': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift' };
  const ORDER = ['Ctrl', 'Alt', 'Shift'];
  const conv = (s) => s.replace(/([⌃⌥⇧⌘]+)(\S)/g, (_m, mods, key) =>
    [...new Set([...mods].map((m) => NAMES[m]))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).concat(key).join('+'));
  const fix = (node) => {
    if (node.nodeType === 3) { if (/[⌃⌥⇧⌘]/.test(node.data)) node.data = conv(node.data); return; }
    if (node.nodeType !== 1) return;
    if (node.title && /[⌃⌥⇧⌘]/.test(node.title)) node.title = conv(node.title);
    for (const c of node.childNodes) fix(c);
  };
  document.addEventListener('DOMContentLoaded', () => {
    fix(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'childList') m.addedNodes.forEach(fix);
        else fix(m.target);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title'] });
  });
}
