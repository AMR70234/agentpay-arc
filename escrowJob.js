require('dotenv').config();
const crypto = require('crypto');
const { callContract, pollTransaction } = require('./contractClient');
const { executeTask } = require('./task');
const { recordJob } = require('./reputation');
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

async function approveUSDC(amount) {
  const amountUnits = toUnits(amount);
  const approveRes = await callContract({
    walletId: process.env.WALLET_ID,
    contractAddress: process.env.USDC_TOKEN_ADDRESS,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [process.env.ESCROW_CONTRACT_ADDRESS, amountUnits],
  });
  const tx = await pollTransaction(approveRes.data.id);
  return tx.state === 'COMPLETE';
}

const DISPUTE_WINDOW_MS = 8000;
const pendingJobs = new Map();

async function runEscrowJob(taskInput, amount) {
  if (!amount) amount = calculatePrice(taskInput);

  const approved = await approveUSDC(amount);
  if (!approved) {
    return { accepted: false, disputable: false, summary: 'USDC approval failed.', taskType: 'error', amount, finalTx: null, stats: null };
  }

  const jobId = '0x' + crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');
  console.log(`On-chain: creating job ${jobId}, escrowing ${amount} USDC...`);

  const createRes = await callContract({
    walletId: process.env.WALLET_ID,
    abiFunctionSignature: 'createJob(bytes32,address,uint256)',
    abiParameters: [jobId, process.env.WORKER_WALLET_ADDRESS, toUnits(amount)],
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
    pendingJobs.set(jobId, { status: 'pending', amount, taskResult, taskInput });

    const timer = setTimeout(async () => {
      const job = pendingJobs.get(jobId);
      if (!job || job.status !== 'pending') return;
      try {
        const releaseRes = await callContract({
          walletId: process.env.WORKER_WALLET_ID,
          abiFunctionSignature: 'release(bytes32)',
          abiParameters: [jobId],
        });
        const releaseTx = await pollTransaction(releaseRes.data.id);
        job.status = 'released';
        job.finalTx = releaseRes.data;
        recordJob(true);
        recordTransaction(jobId, 'released', amount, taskInput, taskResult, releaseTx.txHash);
        console.log(`On-chain auto-release for job ${jobId}: ${releaseRes.data.id}`);
      } catch (err) {
        console.error(`Auto-release failed for job ${jobId}:`, err.message);
      }
    }, DISPUTE_WINDOW_MS);
    pendingJobs.get(jobId).timer = timer;

    return {
      accepted: true,
      disputable: true,
      jobId,
      summary: taskResult.result,
      taskType: taskResult.taskType,
      amount,
      escrowTx: { id: createRes.data.id, state: createTx.state, txHash: createTx.txHash },
      disputeWindowMs: DISPUTE_WINDOW_MS,
      stats: undefined,
    };
  } else {
    console.log('Task rejected — disputing on-chain (client wallet)...');
    const disputeRes = await callContract({
      walletId: process.env.WALLET_ID,
      abiFunctionSignature: 'dispute(bytes32)',
      abiParameters: [jobId],
    });
    const disputeTx = await pollTransaction(disputeRes.data.id);
    const stats = recordJob(false);
    recordTransaction(jobId, 'refunded', amount, taskInput, taskResult, disputeTx.txHash);

    return {
      accepted: false,
      disputable: false,
      summary: taskResult.result,
      taskType: taskResult.taskType,
      amount,
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
  recordJob(false);
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
