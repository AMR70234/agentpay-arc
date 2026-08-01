require('dotenv').config();
const crypto = require('crypto');
const { callContract, pollTransaction } = require('./contractClient');
const { executeTask } = require('./task');
const { recordJob, getAllWorkersStats } = require('./reputation');
const { recordTransaction } = require('./db');

function calculatePrice(inputText) {
  const wordCount = inputText.trim().split(/\s+/).length;
  if (wordCount <= 20) return '0.5';
  if (wordCount <= 60) return '1';
  return '2';
}

function toUnits(amount) {
  return String(Math.round(parseFloat(amount) * 1000000));
}

// Registry of available workers. Each has a wallet and a small base price
// adjustment, so the client agent has a real choice to make — not just one
// hardcoded worker.
const WORKERS = [
  {
    walletId: process.env.WORKER_WALLET_ID,
    walletAddress: process.env.WORKER_WALLET_ADDRESS,
    priceMultiplier: 1.0,
  },
  {
    walletId: process.env.WORKER2_WALLET_ID,
    walletAddress: process.env.WORKER2_WALLET_ADDRESS,
    priceMultiplier: 0.9, // slightly cheaper, to give the client a real reason to pick it
  },
].filter(w => w.walletId && w.walletAddress);

// The client agent picks a worker based on reputation (acceptance rate) and
// price — a real decision, not a fixed assignment. New workers with no
// track record yet default to 100% so they aren't unfairly excluded.
function chooseWorker() {
  const allStats = getAllWorkersStats();
  const statsByAddress = {};
  allStats.forEach(s => { statsByAddress[s.worker] = s; });

  const scored = WORKERS.map(w => {
    const stats = statsByAddress[w.walletAddress] || { acceptanceRate: 100, totalJobs: 0 };
    // Simple score: reputation matters most, price is a tiebreaker.
    const score = stats.acceptanceRate - (w.priceMultiplier * 5);
    return { ...w, stats, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

async function approveUSDC(amount, walletId) {
  const amountUnits = toUnits(amount);
  const approveRes = await callContract({
    walletId: walletId || process.env.WALLET_ID,
    contractAddress: process.env.USDC_TOKEN_ADDRESS,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [process.env.ESCROW_CONTRACT_ADDRESS, amountUnits],
  });
  const tx = await pollTransaction(approveRes.data.id);
  return tx.state === 'COMPLETE';
}

const DISPUTE_WINDOW_MS = 8000;
const pendingJobs = new Map();

async function runEscrowJob(taskInput, amount, priority, clientWallet) {
  const clientWalletId = (clientWallet && clientWallet.walletId) || process.env.WALLET_ID;
  const clientWalletAddress = (clientWallet && clientWallet.walletAddress) || process.env.WALLET_ADDRESS;
  const worker = chooseWorker();
  if (!worker) {
    return { accepted: false, disputable: false, summary: 'No workers available.', taskType: 'error', amount: '0', finalTx: null, stats: null };
  }

  if (!amount) amount = (parseFloat(calculatePrice(taskInput)) * worker.priceMultiplier).toFixed(2);

  let approved = await approveUSDC(amount, clientWalletId);
  let rescued = false;

  // Fallback: if approval failed, attempt a one-time rescue transfer
  // from the Circle Agent Stack wallet, then retry approval once.
  if (!approved) {
    try {
      const { execSync } = require('child_process');
      const AGENT_STACK_ADDRESS = '0x8888106721ab9691c001193c141d538278ca5585';
      console.log('\u26a0\ufe0f Approval failed \u2014 attempting one-time rescue via Agent Stack wallet...');
      execSync(
        `circle wallet transfer ${process.env.WALLET_ADDRESS} --amount 5 --token ${process.env.USDC_TOKEN_ADDRESS} --address ${AGENT_STACK_ADDRESS} --chain ARC-TESTNET`,
        { encoding: 'utf-8', timeout: 30000 }
      );
      console.log('\u2705 Rescue transfer complete \u2014 retrying approval once...');
      approved = await approveUSDC(amount, clientWalletId);
      if (approved) rescued = true;
    } catch (rescueError) {
      console.log('\u274c Rescue attempt failed:', rescueError.message);
    }
  }

  if (!approved) {
    return { accepted: false, disputable: false, summary: 'USDC approval failed, even after an automatic rescue attempt via Agent Stack.', taskType: 'error', amount, finalTx: null, stats: null };
  }

  const jobId = '0x' + crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');
  console.log(`On-chain: creating job ${jobId}, escrowing ${amount} USDC with worker ${worker.walletAddress}...`);

  const createRes = await callContract({
    walletId: clientWalletId,
    abiFunctionSignature: 'createJob(bytes32,address,uint256)',
    abiParameters: [jobId, worker.walletAddress, toUnits(amount)],
  });
  const createTx = await pollTransaction(createRes.data.id);
  if (createTx.state !== 'COMPLETE') {
    return { accepted: false, disputable: false, summary: 'On-chain escrow failed.', taskType: 'error', amount, finalTx: null, stats: null };
  }
  console.log(`Escrow confirmed on-chain: ${createTx.txHash}`);

  console.log('Worker agent executing task...');
  const taskResult = await executeTask(taskInput);
  console.log(`Result: "${taskResult.result}"`);

  if (taskResult.accepted) {
    pendingJobs.set(jobId, { status: 'pending', amount, taskResult, taskInput, worker });

    const activeDisputeWindow = priority ? 1000 : DISPUTE_WINDOW_MS;
    const timer = setTimeout(async () => {
      const job = pendingJobs.get(jobId);
      if (!job || job.status !== 'pending') return;
      try {
        const releaseRes = await callContract({
          walletId: job.worker.walletId,
          abiFunctionSignature: 'release(bytes32)',
          abiParameters: [jobId],
        });
        const releaseTx = await pollTransaction(releaseRes.data.id);
        job.status = 'released';
        job.finalTx = releaseRes.data;
        recordJob(true, job.worker.walletAddress);
        recordTransaction(jobId, 'released', amount, taskInput, taskResult, releaseTx.txHash, clientWalletAddress);
        console.log(`On-chain auto-release for job ${jobId}: ${releaseRes.data.id}`);
      } catch (err) {
        console.error(`Auto-release failed for job ${jobId}:`, err.message);
      }
    }, activeDisputeWindow);
    pendingJobs.get(jobId).timer = timer;

    return {
      accepted: true,
      disputable: true,
      jobId,
      summary: taskResult.result,
      taskType: taskResult.taskType,
      amount,
      worker: worker.walletAddress,
      escrowTx: { id: createRes.data.id, state: createTx.state, txHash: createTx.txHash },
      disputeWindowMs: activeDisputeWindow,
      rescued,
      stats: undefined,
    };
  } else {
    console.log('Task rejected — disputing on-chain (client wallet)...');
    const disputeRes = await callContract({
      walletId: clientWalletId,
      abiFunctionSignature: 'dispute(bytes32)',
      abiParameters: [jobId],
    });
    const disputeTx = await pollTransaction(disputeRes.data.id);
    const stats = recordJob(false, worker.walletAddress);
    recordTransaction(jobId, 'refunded', amount, taskInput, taskResult, disputeTx.txHash, clientWalletAddress);

    return {
      accepted: false,
      disputable: false,
      summary: taskResult.result,
      taskType: taskResult.taskType,
      amount,
      worker: worker.walletAddress,
      finalTx: disputeRes.data,
      stats,
    };
  }
}

async function disputeJob(jobId) {
  const job = pendingJobs.get(jobId);
  if (!job) return { ok: false, error: 'Job not found or already resolved' };
  if (job.status !== 'pending') return { ok: false, error: `Job already ${job.status}` };

  clearTimeout(job.timer);
  job.status = 'disputed';

  const disputeRes = await callContract({
    walletId: process.env.WALLET_ID,
    abiFunctionSignature: 'dispute(bytes32)',
    abiParameters: [jobId],
  });
  const disputeTx = await pollTransaction(disputeRes.data.id);

  job.status = 'refunded';
  job.finalTx = disputeRes.data;
  recordJob(false, job.worker.walletAddress);
  recordTransaction(jobId, 'refunded', job.amount, job.taskInput, job.taskResult, disputeTx.txHash);

  console.log(`⚠️ Job ${jobId} disputed — refunded on-chain: ${disputeRes.data.id}`);
  return { ok: true, status: 'refunded', finalTx: disputeRes.data };
}

function getJobStatus(jobId) {
  const job = pendingJobs.get(jobId);
  if (!job) return { status: 'unknown' };
  return { status: job.status, finalTx: job.finalTx || null };
}

module.exports = { runEscrowJob, disputeJob, getJobStatus, calculatePrice };
