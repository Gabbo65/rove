#!/bin/zsh
# Upgrade the browser engine (Electron = Chromium + Node) and the other dependencies,
# run the full test suite, and rebuild + reinstall the app ONLY if every test passes.
set -e
cd "$(dirname "$0")/.."
echo "→ Current engine: Electron $(node -p "require('electron/package.json').version")"
cp package.json package.json.before-update
cp package-lock.json package-lock.json.before-update
restore() {
  echo "✗ Update failed — putting the previous versions back."
  mv package.json.before-update package.json
  mv package-lock.json.before-update package-lock.json
  npm install --no-audit --no-fund >/dev/null
  exit 1
}
trap restore ERR
npm install --save-dev --no-audit --no-fund electron@latest @electron/packager@latest
npm update --no-audit --no-fund
echo "→ New engine: Electron $(node -p "require('electron/package.json').version")"
echo "→ Running all tests…"
npm test
echo "→ Tests passed. Building and installing…"
npm run install-app
trap - ERR
rm -f package.json.before-update package-lock.json.before-update
echo "✓ Updated. Quit and reopen Rove to use the new engine."
