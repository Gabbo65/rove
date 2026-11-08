# Personal Browser

A personal, Edge-style browser for macOS (Electron) with a phone remote.

## Commands

| | |
|---|---|
| `npm start` | Run from source (for testing changes) |
| `npm run test:compact` | Run only the tests listed in `test/compact.txt` (new/changed features — run after every change) |
| `npm test` | Run the full test suite (~30 s, offline, throwaway profile) — runs automatically before `install-app` |
| `npm test -- passwords` | Run only tests whose file/name contains "passwords" |
| `npm run install-app` | Build the `.app` and copy it to /Applications |
| `npm run update-engine` | Upgrade Electron/Chromium → run tests → reinstall only if they pass |

## Layout

```
main.js                 entry → src/main/app.js
src/main/               main process
  app.js                boot order, shared actions
  window.js / tab.js    a window (UI + tabs); each tab is its own WebContentsView
  windows.js            all windows + glue (favorites, downloads, remote, settings)
  db.js                 SQLite (node:sqlite), schema migrations
  history.js favorites.js closed.js downloads.js settings.js
  suggest.js            address-bar suggestions
  passwords.js autofill.js   encrypted passwords + form data (safeStorage / Keychain)
  settings-page.js      pb://settings backend
  remote.js stream.js   phone remote (HTTPS + WebSocket) and live video mirror (WebRTC)
  updates.js            engine update checks
  migrate.js            one-time import from the old version
  protocol.js ipc.js menu.js permissions.js urls.js paths.js
src/preload/            the only bridges into pages (allow-listed)
src/ui/chrome/          toolbar UI (pb://chrome)        src/ui/hud/  find bar + QR over the page
src/ui/pages/           pb://newtab, history, settings, error
remote/index.html       the phone page
test/                   runner, local fixture web server, specs
scripts/                engine update, build info
_backup_v1/             the previous version (before the rewrite), kept for reference
```

Data lives in `~/Library/Application Support/personal-browser/` (`browser.db`, `remote.json`, `tls/`).
