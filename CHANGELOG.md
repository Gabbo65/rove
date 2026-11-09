# Changelog

All notable changes to Rove. Versions follow [Semantic Versioning](https://semver.org).

## 0.1.2 — 2026-11-09

### Phone remote: hardened
- **New phones must be allowed on the computer** ("Allow / Don't allow"). An allowed phone gets its own key and reconnects without asking.
- **Settings → Phone remote:**
  - turn the remote off completely (then nothing listens on the network)
  - see and remove paired phones
  - make a new QR code that forgets every phone
- **Stronger secret link:**
  - a 128-bit key, checked in constant time
  - after too many wrong tries, that address is refused for a while
  - the key is removed from the phone's address bar and history right after scanning
- Only the phone page itself can connect. Messages are size-limited, with a few phones at most.
- The phone can only open web addresses, never local files. Site icons on the phone are limited to real images.
- `remote.json` is readable only by your user account. The certificate files are written safely.
- Update note: phones paired before 0.1.2 need to scan the QR code once more.

## 0.1.1 — 2026-11-09

### Security
- **The browser's own toolbar can no longer be taken over by a web page.** Before this fix, dropping a link onto the tab strip could load that site into the browser's UI, where it could reach the browser's controls. The UI views now never navigate, never open windows, and ignore drops, and the browser's bridge only exists on its own pages.
- **Locked-down release builds** (Electron fuses):
  - No Node mode, `NODE_OPTIONS` or `--inspect` debugging switches.
  - Encrypted cookie storage.
  - App code only loads from the packaged, integrity-checked archive.
  - `file://` pages get no extra privileges, so a saved web page can't read other files on your disk.
- **Links that open another app** (`mailto:`, meeting links …) now ask first: "Open / Cancel", remembered per site. Before, they were silently blocked.
- **Devices:** Web Bluetooth requests are refused instead of silently connecting to the first nearby device. USB, serial and HID requests are refused too.
- **Context menu:** "Open link / image in new tab" won't open Rove's internal pages from a web page.
- Updated `ws` to 8.22.2.

### Phone remote
- **Follows Wi-Fi changes:** a new address gets a new link, certificate and QR code automatically. When the computer is offline, the QR card says "Connect this computer to Wi-Fi".

### Project
- `SECURITY.md` (private vulnerability reporting), issue templates, Dependabot and CodeQL scanning.

## 0.1.0 — 2026-11-08

First release: tabs with sleeping and undo-close, smart address bar, favorites bar, history, downloads, find, zoom, InPrivate windows, encrypted passwords and address autofill, settings, update checks, and the phone remote (Basic + Advanced live mirror). Builds for Windows, macOS and Linux.
