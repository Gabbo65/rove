# Security

## Reporting a vulnerability

Please **don't** open a public issue for security problems.

Report them privately through GitHub: **[Report a vulnerability](https://github.com/Gabbo65/rove/security/advisories/new)**. Include:
- what you found
- how to reproduce it
- the Rove version and system

You'll get an answer as soon as possible. Once a fix is released, you can be credited in the release notes if you'd like.

## Supported versions

Only the [latest release](https://github.com/Gabbo65/rove/releases/latest) gets security fixes. Rove checks for new versions by itself (Settings → Updates).

## How Rove protects you

- **Web pages are isolated.** Every tab runs sandboxed, in its own process, with no access to Node.js or the browser's internals. Pages can't open, frame or message Rove's own pages (`pb://`).
- **The browser's own UI only shows Rove's own pages.** Its views can't be navigated, can't open windows, and ignore dropped links and files. The bridge to the browser only exists on Rove's own pages.
- **Every message from a page or the UI is checked against the sender.** A page can only ever reach the passwords saved for its own site, and only after a real click on the in-page chooser.
- **Passwords and addresses are encrypted** with your system's key store (macOS Keychain, Windows account / DPAPI, Linux Secret Service). If no secure store exists, Rove refuses to save them.
- **Permissions are asked, not granted:** camera, microphone, location, notifications, clipboard reading and screen recording. USB, serial, HID and Bluetooth devices are refused, and links that open other apps (`mailto:` …) ask first.
- **Locked-down app binary.** Release builds turn off Electron's debugging and Node-mode switches (`ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect`). They also encrypt cookies on disk, load code only from the packaged archive (with integrity checks), and give `file://` pages no extra powers.
- **Every change is tested** on macOS, Windows and Linux. The code is scanned by GitHub CodeQL, and dependencies are watched by Dependabot.

## Phone remote: know the limits

The phone remote is meant for **your own Wi-Fi**:
- **Secret link:** it's protected by a secret 128-bit link (the QR code), over HTTPS with a certificate your computer makes for itself.
- **Pairing:** every new phone also has to be **allowed on the computer**, once.
- **Settings → Phone remote:**
  - remove paired phones
  - make a new QR code that forgets them all
  - turn the remote off, so nothing listens on the network at all
- **Limits:** wrong keys are rate-limited. Only the phone page can connect, and the phone can only open web addresses.

The certificate is self-made, not from a public authority, so the very first connection relies on you scanning your own screen.
