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
  // Create a test table using vec0
  db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS test_vec USING vec0(id INTEGER PRIMARY KEY, embedding F32[4])');
  console.log('✅ test_vec table created');
  // Insert a test vector using a literal integer for id
  const testVec = Buffer.from(new Float32Array([0.1, 0.2, 0.3, 0.4]).buffer);
  // Use SQL with literal id and bind only the embedding
  const insert = db.prepare('INSERT INTO test_vec(id, embedding) VALUES(1, ?)');
  insert.run(testVec);
  console.log('✅ Test vector inserted');
  // Query the vector
  const query = db.prepare('SELECT * FROM test_vec');
  const rows = query.all();
  console.log('Queried rows:', rows);
  db.close();
} catch (err) {
  console.error('❌ Failed to run test query:', err);
}
