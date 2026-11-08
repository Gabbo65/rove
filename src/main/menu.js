// App menu. Shortcuts work even while a web page has keyboard focus.
// Actions run in the main process on the current window; UI-only ones are forwarded to its toolbar.
const { Menu, app } = require('electron');

function build(hub) {
  const win = () => hub.current();
  const tab = () => win()?.active || null;
  const ui = (name, data) => win()?.sendUI('command', { name, ...data });
  const zoom = (step) => {
    const wc = tab()?.wc;
    if (wc) wc.setZoomLevel(step === 0 ? 0 : Math.max(-4, Math.min(5, wc.getZoomLevel() + step)));
  };

  const template = [
    { label: app.getName(), submenu: [
      { role: 'about' },
      { label: 'Check for Updates…', click: () => require('./updates').check().then(() => require('./updates').prompt()) },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => hub.openInternal('settings') },
      { type: 'separator' },
      { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
      { role: 'quit' },
    ] },
    { label: 'File', submenu: [
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => (win() ? win().newTab() : hub.create()) },
      { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => hub.create() },
      { label: 'New InPrivate Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => hub.create({ isPrivate: true }) },
      { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => win()?.reopenClosed() },
      { type: 'separator' },
      { label: 'Open Location…', accelerator: 'CmdOrCtrl+L', click: () => ui('focus-url') },
      { type: 'separator' },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => { const w = win(); if (w?.active) w.close(w.active); } },
      { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => win()?.base.close() },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => win()?.openFind() },
      { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: () => hub.findNext(1) },
      { label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G', click: () => hub.findNext(-1) },
    ] },
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => tab()?.reload() },
      { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => tab()?.reload(true) },
      { label: 'Stop', accelerator: 'CmdOrCtrl+.', click: () => tab()?.stop() },
      { type: 'separator' },
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.5) },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
      { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
      { type: 'separator' },
      { label: 'Show Favorites Bar', accelerator: 'CmdOrCtrl+Shift+B', click: () => hub.toggleFavoritesBar() },
      { label: 'Show Remote QR Code', accelerator: 'CmdOrCtrl+Shift+Q', click: () => win()?.toggleQR() },
      { type: 'separator' },
      { label: 'Developer Tools (Page)', accelerator: 'Alt+CmdOrCtrl+I', click: () => tab()?.wc?.toggleDevTools() },
      { label: 'Developer Tools (Browser UI)', click: () => win()?.chrome.webContents.toggleDevTools() },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ] },
    { label: 'History', submenu: [
      { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => tab()?.back() },
      { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => tab()?.forward() },
      { type: 'separator' },
      { label: 'Show All History', accelerator: 'CmdOrCtrl+Y', click: () => hub.openInternal('history') },
      { label: 'Downloads', accelerator: 'CmdOrCtrl+Shift+J', click: () => ui('downloads') },
    ] },
    { label: 'Favorites', submenu: [
      { label: 'Add This Page to Favorites', accelerator: 'CmdOrCtrl+D', click: () => ui('star') },
    ] },
    { label: 'Tabs', submenu: [
      { label: 'Search Tabs…', accelerator: 'CmdOrCtrl+Shift+A', click: () => ui('tab-search') },
      { label: 'Pin / Unpin Tab', click: () => { const w = win(); if (w?.active) w.setPinned(w.active, !w.active.pinned); } },
      { type: 'separator' },
      { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => hub.cycleTab(1) },
      { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => hub.cycleTab(-1) },
      { type: 'separator' },
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ label: `Tab ${n}`, accelerator: `CmdOrCtrl+${n}`, click: () => hub.selectTab(n - 1) })),
      { label: 'Last Tab', accelerator: 'CmdOrCtrl+9', click: () => hub.selectTab(-1) },
    ] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { build, appName: () => app.getName() };
