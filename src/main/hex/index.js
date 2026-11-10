// Hex setup: first-party items. Each later phase (Injector, Magic tools, Extract) registers its own here.
const core = require('./core');

const { app } = require('electron');
const settings = require('../settings');

// Hex wheel colors: [id, name, main color] (the glow uses a lighter partner color, see style.css)
const HEX_COLORS = [['violet', 'Violet', '#a78bfa'], ['magenta', 'Magenta', '#e879f9'], ['blue', 'Blue', '#60a5fa'],
  ['cyan', 'Cyan', '#22d3ee'], ['green', 'Green', '#4ade80'], ['amber', 'Amber', '#fbbf24'], ['red', 'Red', '#f87171']];

// Does a key press match the Hex Trigger (an accelerator like "Alt+H" / "CmdOrCtrl+Shift+K")?
function matches(acc, input) {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return false;
  const parts = String(acc || '').split('+');
  const key = parts.pop();
  const want = { meta: false, control: false, alt: false, shift: false };
  const mac = process.platform === 'darwin';
  for (const m of parts) {
    if (m === 'CmdOrCtrl') want[mac ? 'meta' : 'control'] = true;
    else if (m === 'Ctrl') want.control = true;
    else if (m === 'Alt') want.alt = true;
    else if (m === 'Shift') want.shift = true;
    else if (m === 'Super') want.meta = true;
  }
  const code = /^[A-Z]$/.test(key) ? `Key${key}` : /^[0-9]$/.test(key) ? `Digit${key}` : key;
  return input.code === code && Object.keys(want).every((m) => !!input[m] === want[m]);
}

function setup(hub) {
  // The trigger is caught before the page or a text box sees it (⌥H would otherwise type "˙" on a Mac).
  app.on('web-contents-created', (_e, wc) => {
    wc.on('before-input-event', (event, input) => {
      if (!matches(settings.get('hexTrigger'), input)) return;
      const win = hub.fromChrome(wc) || hub.fromTabWebContents(wc)?.win || hub.current();
      if (!win) return;
      event.preventDefault(); // also stops the menu shortcut, so it fires once
      core.open(win);
    });
  });

  // Settings family: everything is changed right in the wheel.
  core.register({ id: 'hex.trigger', family: 'options', kind: 'key', icon: 'key', name: 'Trigger',
    description: 'Press the new shortcut that opens Hex' });
  core.register({ id: 'hex.mode', family: 'options', kind: 'group', icon: 'mode', name: 'Mode',
    description: 'Smooth: hover opens, click runs · Bumpy: click everything' });
  for (const [id, name, description] of [['smooth', 'Smooth', 'Hover opens families and groups; click runs a command'],
    ['bumpy', 'Bumpy', 'Click to open and to run — nothing happens on hover']]) {
    core.register({ id: `hex.mode.${id}`, family: 'options', parent: 'hex.mode', name, description, icon: id,
      stay: true, current: () => settings.get('hexMode') === id, run: () => { settings.set({ hexMode: id }); } });
  }
  core.register({ id: 'hex.color', family: 'options', kind: 'group', icon: 'color', name: 'Color',
    description: 'The color of the Hex wheel' });
  for (const [id, name, color] of HEX_COLORS) {
    core.register({ id: `hex.color.${id}`, family: 'options', parent: 'hex.color', name, color, description: `${name} Hex`,
      stay: true, current: () => settings.get('hexColor') === id, run: () => { settings.set({ hexColor: id }); } });
  }
  hub.hex = core;
  return core;
}

module.exports = { setup, matches, HEX_COLORS };
