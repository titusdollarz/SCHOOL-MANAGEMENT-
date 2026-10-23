// One-command backup: node backup.js
const fs = require('fs');
const path = require('path');
const { DATA_DIR, SCHOOLS_DIR, SYSTEM_FILE } = require('./db');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destDir = path.join(DATA_DIR, `backup.${stamp}`);
fs.mkdirSync(destDir, { recursive: true });

let n = 0;
if (fs.existsSync(SYSTEM_FILE)) { fs.copyFileSync(SYSTEM_FILE, path.join(destDir, 'system.json')); n++; }
if (fs.existsSync(SCHOOLS_DIR)) {
  const sd = path.join(destDir, 'schools');
  fs.mkdirSync(sd, { recursive: true });
  for (const f of fs.readdirSync(SCHOOLS_DIR)) { fs.copyFileSync(path.join(SCHOOLS_DIR, f), path.join(sd, f)); n++; }
}
console.log(`Backup saved to ${destDir} (${n} file(s): system.json + every school database).`);
console.log('Tip: upload the backup folder to Google Drive / Dropbox for cloud backup.');
