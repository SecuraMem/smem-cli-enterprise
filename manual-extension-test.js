const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'manual-test.db');
const dllPath = path.join(__dirname, '..', '.securamem', 'sqlite-vec', 'win32-x64', 'vec0.dll');

console.log('DB Path:', dbPath);
console.log('DLL Path:', dllPath);

try {
  const db = new Database(dbPath);
  db.loadExtension(dllPath);
  console.log('✅ Extension loaded successfully!');
  // Optionally, run a test query to verify
  // db.exec('SELECT sqlite_version();');
  db.close();
} catch (err) {
  console.error('❌ Failed to load extension:', err);
}
