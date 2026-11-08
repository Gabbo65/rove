// Renders build/icon.svg to all macOS icon sizes, then builds build/icon.icns with iconutil.
// Run: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SIZES = [16, 32, 64, 128, 256, 512, 1024];
const out = path.join(__dirname, 'icon.iconset');

app.whenReady().then(async () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out);
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false,
    useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 300));
  const full = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const base = full.getSize().width > 1024 ? full.resize({ width: 1024, quality: 'best' }) : full;
  fs.writeFileSync(path.join(__dirname, 'icon.png'), base.toPNG());
  const names = { 16: ['16x16'], 32: ['16x16@2x', '32x32'], 64: ['32x32@2x'], 128: ['128x128'],
    256: ['128x128@2x', '256x256'], 512: ['256x256@2x', '512x512'], 1024: ['512x512@2x'] };
  for (const s of SIZES) {
    const png = base.resize({ width: s, height: s, quality: 'best' }).toPNG();
    for (const n of names[s]) fs.writeFileSync(path.join(out, `icon_${n}.png`), png);
  }
  execFileSync('iconutil', ['-c', 'icns', out, '-o', path.join(__dirname, 'icon.icns')]);
  fs.rmSync(out, { recursive: true, force: true });
  console.log('Made build/icon.icns');
  app.exit(0);
});
