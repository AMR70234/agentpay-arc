const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'reputation.json');

function loadAll() {
  try {
    const data = fs.readFileSync(FILE_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    // Migrate old single-worker format if found
    if (parsed.totalJobs !== undefined && !parsed[process.env.WORKER_WALLET_ADDRESS]) {
      return { [process.env.WORKER_WALLET_ADDRESS]: parsed };
    }
    return parsed;
  } catch (err) {
    return {};
  }
}

function saveAll(data) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

function recordJob(accepted, workerAddress) {
  const address = workerAddress || process.env.WORKER_WALLET_ADDRESS;
  const all = loadAll();
  const rep = all[address] || { totalJobs: 0, accepted: 0, rejected: 0 };
  rep.totalJobs += 1;
  if (accepted) rep.accepted += 1;
  else rep.rejected += 1;
  all[address] = rep;
  saveAll(all);
  return getStats(address);
}

function getStats(workerAddress) {
  const address = workerAddress || process.env.WORKER_WALLET_ADDRESS;
  const all = loadAll();
  const rep = all[address] || { totalJobs: 0, accepted: 0, rejected: 0 };
  const acceptanceRate = rep.totalJobs > 0
    ? Math.round((rep.accepted / rep.totalJobs) * 100)
    : 100;
  return { ...rep, acceptanceRate, worker: address };
}

function getAllWorkersStats() {
  const all = loadAll();
  return Object.keys(all).map(address => getStats(address));
}

module.exports = { recordJob, getStats, getAllWorkersStats };
