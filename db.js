const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'agentpay.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS jobs (
    jobId TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    amount TEXT NOT NULL,
    taskInput TEXT,
    taskResult TEXT,
    txHash TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

function recordTransaction(jobId, status, amount, taskInput, taskResult, txHash) {
  db.run(
    `INSERT OR REPLACE INTO jobs (jobId, status, amount, taskInput, taskResult, txHash)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [jobId, status, amount, taskInput || null, JSON.stringify(taskResult || null), txHash || null],
    (err) => { if (err) console.error('Failed to record transaction:', err.message); }
  );
}

function getRecentTransactions(limit, callback) {
  db.all(
    'SELECT * FROM jobs ORDER BY createdAt DESC LIMIT ?',
    [limit || 50],
    callback
  );
}

module.exports = db;
module.exports.recordTransaction = recordTransaction;
module.exports.getRecentTransactions = getRecentTransactions;
