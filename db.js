const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'agentpay-jobs.json');

function loadJobs() {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveJobs(jobs) {
  fs.writeFileSync(DB_FILE, JSON.stringify(jobs, null, 2));
}

function recordTransaction(jobId, status, amount, taskInput, taskResult, txHash, walletAddress) {
  const jobs = loadJobs();
  const existingIndex = jobs.findIndex(j => j.jobId === jobId);
  const record = {
    jobId,
    status,
    amount,
    taskInput: taskInput || null,
    taskResult: taskResult || null,
    txHash: txHash || null,
    walletAddress: walletAddress || null,
    createdAt: new Date().toISOString(),
  };
  if (existingIndex >= 0) {
    jobs[existingIndex] = record;
  } else {
    jobs.unshift(record); // newest first
  }
  saveJobs(jobs);
}

function getRecentTransactions(limit, callback, walletAddress) {
  const jobs = loadJobs();
  const filtered = walletAddress ? jobs.filter(j => j.walletAddress === walletAddress) : jobs;
  const sliced = filtered.slice(0, limit || 50);
  callback(null, sliced);
}

module.exports = { recordTransaction, getRecentTransactions };
