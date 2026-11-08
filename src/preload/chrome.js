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

contextBridge.exposeInMainWorld('pb', {
  send(channel, ...args) { if (SEND.has(channel)) ipcRenderer.send(channel, ...args); },
  invoke(channel, ...args) { return INVOKE.has(channel) ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error('blocked')); },
  on(channel, fn) {
    if (!LISTEN.has(channel)) return () => {};
    const handler = (_e, data) => fn(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
