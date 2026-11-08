// Rove — entry point. The real code lives in src/main/ (see src/main/app.js).
// PB_KEY_EXPORT: one-time helper used when moving saved passwords from the old name (see src/main/rename.js).
if (process.env.PB_KEY_EXPORT) require('./src/main/rename').childExport();
else require('./src/main/app');
