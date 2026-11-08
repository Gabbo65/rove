// Where things live. Everything else imports paths from here.
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

module.exports = {
  ROOT,
  UI: path.join(ROOT, 'src', 'ui'),
  PRELOAD: {
    chrome: path.join(ROOT, 'src', 'preload', 'chrome.js'),
    tab: path.join(ROOT, 'src', 'preload', 'tab.js'),
    streamer: path.join(ROOT, 'src', 'preload', 'streamer.js'),
    migrate: path.join(ROOT, 'src', 'preload', 'migrate.js'),
  },
  REMOTE_HTML: path.join(ROOT, 'remote', 'index.html'),
  MIGRATE_HTML: path.join(ROOT, 'src', 'migrate', 'index.html'),
};
