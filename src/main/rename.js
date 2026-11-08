// One-time move from the old name ("Personal Browser") to Rove.
//
// 1. Data folder: personal-browser/ → rove/ (copied, the old folder is left untouched as a backup).
// 2. Saved passwords and addresses are encrypted with a key the system files under the APP NAME
//    (macOS Keychain "Personal Browser Safe Storage", Linux keyring; Windows keeps it in the folder).
//    Rove can't use that key under its new name, so a short helper process starts under the old name,
//    unlocks the secrets and hands them over a pipe (never written to disk); Rove locks them again with
//    its own key. On a Mac the system may ask once for your password to allow it.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const OLD_NAME = 'Personal Browser';
const OLD_FOLDER = 'personal-browser';
const NEW_FOLDER = 'rove';
const FLAG = '.rekey-pending';
const SKIP = /^(Singleton(Lock|Cookie|Socket)|lockfile|Crashpad|.*Cache.*)$/i; // locks and caches aren't worth copying

const folders = () => {
  const appData = app.getPath('appData');
  return { oldDir: process.env.PB_OLD_DATA_DIR || path.join(appData, OLD_FOLDER),
    newDir: process.env.PB_NEW_DATA_DIR || path.join(appData, NEW_FOLDER) }; // overrides: for trying the move on copies
};

// Before 'ready': copy the old folder into the new one if the new one has no data yet.
function copyIfNeeded(newDir, oldDir) {
  if (fs.existsSync(path.join(newDir, 'browser.db')) || !fs.existsSync(path.join(oldDir, 'browser.db'))) return false;
  fs.mkdirSync(newDir, { recursive: true });
  for (const name of fs.readdirSync(oldDir)) {
    if (SKIP.test(name)) continue;
    fs.cpSync(path.join(oldDir, name), path.join(newDir, name), { recursive: true });
  }
  fs.writeFileSync(path.join(newDir, FLAG), oldDir);
  return true;
}

// Helper process: runs under the old name, prints the unlocked secrets as one JSON line, exits.
function childExport() {
  const dbFile = process.env.PB_KEY_EXPORT;
  app.setName(process.env.PB_OLD_NAME || OLD_NAME);
  if (process.env.PB_KEY_USERDATA) app.setPath('userData', process.env.PB_KEY_USERDATA);
  app.dock?.hide?.();
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(dbFile, { readOnly: true });
    const open = async (buf) => (await safeStorage.decryptStringAsync(Buffer.from(buf))).result;
    const out = { credentials: [], profiles: [] };
    for (const r of d.prepare('SELECT id, password FROM credentials').all()) out.credentials.push({ id: r.id, value: await open(r.password) });
    for (const r of d.prepare('SELECT id, data FROM form_profiles').all()) out.profiles.push({ id: r.id, value: await open(r.data) });
    d.close();
    process.stdout.write(`${JSON.stringify(out)}\n`, () => app.exit(0));
  }).catch((err) => { process.stderr.write(String(err?.stack || err)); app.exit(1); });
}

function runChild(dbFile, oldDir, { timeout = 180_000 } = {}) {
  const ROOT = path.join(__dirname, '..', '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rove-rekey-'));
  // Windows keeps its key in "Local State" inside the data folder: give the helper that file.
  try { fs.copyFileSync(path.join(oldDir, 'Local State'), path.join(tmp, 'Local State')); } catch {}
  const env = { ...process.env, PB_KEY_EXPORT: dbFile, PB_KEY_USERDATA: tmp };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, app.isPackaged ? [] : [ROOT, ...(process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err += b; });
    const timer = setTimeout(() => child.kill(), timeout);
    child.on('close', (code) => {
      clearTimeout(timer);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      const line = out.split('\n').reverse().find((l) => l.startsWith('{'));
      if (code === 0 && line) { try { return resolve(JSON.parse(line)); } catch {} }
      reject(new Error(`helper failed (${code}): ${err.split('\n').find((l) => l.trim() && !/^\[\d+:/.test(l)) || 'no output'}`));
    });
  });
}

// After the database is open: re-lock moved secrets with Rove's key. Returns what happened.
async function rekeyIfPending(conn, dataDir) {
  const flag = path.join(dataDir, FLAG);
  if (!fs.existsSync(flag)) return null;
  const oldDir = fs.readFileSync(flag, 'utf8');
  const count = conn.prepare('SELECT (SELECT COUNT(*) FROM credentials) + (SELECT COUNT(*) FROM form_profiles) AS n').get().n;
  let result = { moved: 0, lost: 0 };
  if (count > 0) {
    try {
      const plain = await runChild(path.join(dataDir, 'browser.db'), oldDir);
      const lock = async (v) => safeStorage.encryptStringAsync(String(v));
      const upCred = conn.prepare('UPDATE credentials SET password = ? WHERE id = ?');
      const upProf = conn.prepare('UPDATE form_profiles SET data = ? WHERE id = ?');
      const rows = [];
      for (const c of plain.credentials) rows.push([upCred, await lock(c.value), c.id]);
      for (const p of plain.profiles) rows.push([upProf, await lock(p.value), p.id]);
      conn.exec('BEGIN');
      for (const [st, blob, id] of rows) st.run(blob, id);
      conn.exec('COMMIT');
      result = { moved: rows.length, lost: 0 };
    } catch (err) {
      // Couldn't unlock (e.g. access denied): drop the copies we can't read — they're still in the old folder.
      try { conn.exec('ROLLBACK'); } catch {}
      conn.exec('DELETE FROM credentials; DELETE FROM form_profiles;');
      result = { moved: 0, lost: count, error: String(err.message || err) };
    }
  }
  fs.rmSync(flag, { force: true });
  return { ...result, oldDir };
}

module.exports = { OLD_NAME, folders, copyIfNeeded, childExport, runChild, rekeyIfPending };
