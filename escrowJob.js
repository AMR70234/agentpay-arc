require('dotenv').config();
const { executeTask } = require('./task');
const { recordJob } = require('./reputation');

// Circle App Kit — official Circle SDK for Send/Bridge/Swap/Unified Balance,
// used here (via the Circle Wallets adapter) to move USDC between our
// developer-controlled wallets, instead of a raw Circle API call.
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

  let finalTx;
  if (taskResult.accepted) {
    log.push(`✅ Task accepted — releasing funds to worker...`);
    finalTx = await transferUSDC(
      process.env.ESCROW_WALLET_ADDRESS,
      process.env.WORKER_WALLET_ADDRESS,
      amount
    );
    log.push(`✅ Release transaction: ${finalTx.id} (${finalTx.state})`);
  } else {
    log.push(`❌ Task rejected — refunding client...`);
    finalTx = await transferUSDC(
      process.env.ESCROW_WALLET_ADDRESS,
      process.env.WALLET_ADDRESS,
      amount
    );
    log.push(`✅ Refund transaction: ${finalTx.id} (${finalTx.state})`);
  }

  const stats = recordJob(taskResult.accepted);
  log.push(`📊 Worker stats: ${stats.accepted}/${stats.totalJobs} accepted (${stats.acceptanceRate}%)`);

  log.forEach(line => console.log(line));

  return {
    accepted: taskResult.accepted,
    summary: taskResult.result,
    taskType: taskResult.taskType,
    amount,
    escrowTx,
    finalTx,
    stats,
  };
}

module.exports = { runEscrowJob, calculatePrice };

if (require.main === module) {
  const sampleText = "Arc is a Layer-1 blockchain built by Circle specifically for stablecoin finance. It uses USDC as the native gas token, offers sub-second transaction finality, and provides a full developer platform for building payment applications, DeFi products, and autonomous AI agents that can transact value in real time without human intervention.";
  runEscrowJob(sampleText);
}
