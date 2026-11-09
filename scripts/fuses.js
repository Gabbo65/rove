// Locks down a packaged app (the Mac build from `npm run package`) with the same Electron fuses the release
// installers get (package.json → build.electronFuses). Run before signing.
//   node scripts/fuses.js "dist/Rove-darwin-arm64/Rove.app"
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const { build } = require('../package.json');

const NAMES = {
  runAsNode: FuseV1Options.RunAsNode,
  enableCookieEncryption: FuseV1Options.EnableCookieEncryption,
  enableNodeOptionsEnvironmentVariable: FuseV1Options.EnableNodeOptionsEnvironmentVariable,
  enableNodeCliInspectArguments: FuseV1Options.EnableNodeCliInspectArguments,
  enableEmbeddedAsarIntegrityValidation: FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
  onlyLoadAppFromAsar: FuseV1Options.OnlyLoadAppFromAsar,
  grantFileProtocolExtraPrivileges: FuseV1Options.GrantFileProtocolExtraPrivileges,
};

const app = process.argv[2];
if (!app) { console.error('usage: node scripts/fuses.js <path to app>'); process.exit(1); }
const config = { version: FuseVersion.V1 };
for (const [name, value] of Object.entries(build.electronFuses || {})) {
  // The packager build has no asar integrity hash in Info.plist; checking it there would refuse to start.
  if (name === 'enableEmbeddedAsarIntegrityValidation') continue;
  if (name in NAMES) config[NAMES[name]] = value;
}
flipFuses(app, config).then(() => console.log('Fuses set:', app)).catch((err) => { console.error(err); process.exit(1); });
