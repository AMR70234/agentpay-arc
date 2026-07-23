require('dotenv').config();
const { executeTask } = require('./task');
const { recordJob } = require('./reputation');

let appKitPromise = null;
async function getAppKit() {
  if (!appKitPromise) {
    appKitPromise = (async () => {
      const { createCircleWalletsAdapter } = await import('@circle-fin/adapter-circle-wallets');
      const { AppKit } = await import('@circle-fin/app-kit');
      const adapter = createCircleWalletsAdapter({
        apiKey: process.env.CIRCLE_API_KEY,
        entitySecret: process.env.CIRCLE_ENTITY_SECRET,
      });
      return { kit: new AppKit(), adapter };
    })();
  }
  return appKitPromise;
}

function calculatePrice(inputText) {
  const wordCount = inputText.trim().split(/\s+/).length;
  if (wordCount <= 20) return '0.5';
  if (wordCount <= 60) return '1';
  return '2';
}

async function transferUSDC(fromWalletAddress, toAddress, amount) {
  const { kit, adapter } = await getAppKit();
  const result = await kit.send({
    from: { adapter, chain: 'Arc_Testnet', address: fromWalletAddress },
    to: toAddress,
    amount: String(amount),
    token: 'USDC',
  });
  return { id: result.txHash, state: result.state, explorerUrl: result.explorerUrl };
}

const DISPUTE_WINDOW_MS = 8000;
const pendingJobs = new Map();

async function runEscrowJob(taskInput, amount) {
  if (!amount) amount = calculatePrice(taskInput);
  const log = [];

  log.push(`💰 Escrowing ${amount} USDC from client...`);
  const escrowTx = await transferUSDC(
    process.env.WALLET_ADDRESS,
    process.env.ESCROW_WALLET_ADDRESS,
    amount
  );
  log.push(`✅ Escrow transaction: ${escrowTx.id} (${escrowTx.state})`);

  log.push(`🤖 Worker agent executing task...`);
  const taskResult = await executeTask(taskInput);
  log.push(`📄 Result: "${taskResult.result}"`);

  const jobId = escrowTx.id;

  if (taskResult.accepted) {
    log.push(`✅ Task accepted — entering ${DISPUTE_WINDOW_MS / 1000}s dispute window before release...`);

    pendingJobs.set(jobId, { status: 'pending', amount, taskResult });

    const timer = setTimeout(async () => {
      const job = pendingJobs.get(jobId);
      if (!job || job.status !== 'pending') return;
      try {
        const finalTx = await transferUSDC(
          process.env.ESCROW_WALLET_ADDRESS,
          process.env.WORKER_WALLET_ADDRESS,
          amount
        );
        job.status = 'released';
        job.finalTx = finalTx;
        recordJob(true);
        console.log(`✅ Auto-released job ${jobId}: ${finalTx.id} (${finalTx.state})`);
      } catch (err) {
        console.error(`❌ Auto-release failed for job ${jobId}:`, err.message);
      }
    }, DISPUTE_WINDOW_MS);

    pendingJobs.get(jobId).timer = timer;

    log.forEach(line => console.log(line));

    return {
      accepted: true,
      disputable: true,
      jobId,
      summary: taskResult.result,
      taskType: taskResult.taskType,
      amount,
      escrowTx,
      disputeWindowMs: DISPUTE_WINDOW_MS,
      stats: undefined,
    };
  } else {
    log.push(`❌ Task rejected — refunding client...`);
    const finalTx = await transferUSDC(
      process.env.ESCROW_WALLET_ADDRESS,
      process.env.WALLET_ADDRESS,
      amount
    );
    log.push(`✅ Refund transaction: ${finalTx.id} (${finalTx.state})`);

    const stats = recordJob(false);
    log.push(`📊 Worker stats: ${stats.accepted}/${stats.totalJobs} accepted (${stats.acceptanceRate}%)`);
    log.forEach(line => console.log(line));

    return {
      accepted: false,
      disputable: false,
      summary: taskResult.result,
      taskType: taskResult.taskType,
      amount,
      finalTx,
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

  const finalTx = await transferUSDC(
    process.env.ESCROW_WALLET_ADDRESS,
    process.env.WALLET_ADDRESS,
    job.amount
  );
  job.status = 'refunded';
  job.finalTx = finalTx;
  recordJob(false);

  console.log(`⚠️ Job ${jobId} disputed — refunded to client: ${finalTx.id}`);
  return { ok: true, status: 'refunded', finalTx };
}

function getJobStatus(jobId) {
  const job = pendingJobs.get(jobId);
  if (!job) return { status: 'unknown' };
  return { status: job.status, finalTx: job.finalTx || null };
}

module.exports = { runEscrowJob, disputeJob, getJobStatus, calculatePrice };

if (require.main === module) {
  const sampleText = "Arc is a Layer-1 blockchain built by Circle specifically for stablecoin finance. It uses USDC as the native gas token, offers sub-second transaction finality, and provides a full developer platform for building payment applications, DeFi products, and autonomous AI agents that can transact value in real time without human intervention.";
  runEscrowJob(sampleText).then(r => console.log('\nFinal result:', r));
}
