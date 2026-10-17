const fs = require('node:fs');
const crypto = require('node:crypto');
const Database = require(process.argv[4] || 'better-sqlite3');
const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
try {
  const integrity = db.pragma('quick_check');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x => x.name);
  const rows = tables.includes('library_entries') ? db.prepare('SELECT * FROM library_entries ORDER BY 1').all() : [];
  const summary = { integrity, libraryCount: rows.length, libraryHash: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'), titleCount: tables.includes('titles') ? db.prepare('SELECT count(*) AS count FROM titles').get().count : null };
  fs.writeFileSync(process.argv[3], JSON.stringify({ ...summary, library: rows }, null, 2));
  console.log(JSON.stringify(summary));
} finally { db.close(); }
