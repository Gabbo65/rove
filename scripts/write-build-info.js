// Run before packaging: lets the installed app find this source folder (for "Update now").
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'src', 'main', 'build-info.json'), JSON.stringify({
  sourceDir: root,
  builtAt: new Date().toISOString(),
  electron: require('electron/package.json').version,
}, null, 2));
