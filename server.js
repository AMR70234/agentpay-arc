require('dotenv').config();
const express = require('express');
const cors = require('cors');
const client = require('./circleClient');
const { runEscrowJob, disputeJob, getJobStatus } = require('./escrowJob');
const { getRecentTransactions } = require('./db');
const { getStats } = require('./reputation');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/run-job', async (req, res) => {
  const { taskInput, amount } = req.body;

  if (!taskInput) {
    return res.status(400).json({ error: 'Missing taskInput in request body' });
  }

  try {
    console.log('🚀 Job started...');
    const result = await runEscrowJob(taskInput, amount);

    return res.json({
      accepted: result.accepted,
      disputable: result.disputable,
      jobId: result.jobId,
      disputeWindowMs: result.disputeWindowMs,
      summary: result.summary,
      taskType: result.taskType,
      amount: result.amount,
      transaction: result.finalTx || result.escrowTx,
      stats: result.stats,
    });
  } catch (error) {
    console.error('❌ Error in /run-job:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/dispute', async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: 'Missing jobId in request body' });
    const result = await disputeJob(jobId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  } catch (error) {
    console.error('Error in /dispute:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/job-status/:jobId', (req, res) => {
  const result = getJobStatus(req.params.jobId);
  res.json(result);
});

app.get('/balances', async (req, res) => {
  try {
    const [clientBal, escrowBal, workerBal, worker2Bal] = await Promise.all([
      client.getWalletTokenBalance({ id: process.env.WALLET_ID }),
      client.getWalletTokenBalance({ id: process.env.ESCROW_WALLET_ID }),
      client.getWalletTokenBalance({ id: process.env.WORKER_WALLET_ID }),
      client.getWalletTokenBalance({ id: process.env.WORKER2_WALLET_ID }),
    ]);

    const getUsdc = (balanceResponse) => {
      const token = balanceResponse.data.tokenBalances.find(t => !t.token.isNative);
      return token ? token.amount : '0';
    };

    res.json({
      client: getUsdc(clientBal),
      escrow: getUsdc(escrowBal),
      worker2: getUsdc(worker2Bal),
      worker: getUsdc(workerBal),
    });
  } catch (error) {
    console.error('❌ Error in /balances:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/transactions', (req, res) => {
  getRecentTransactions(50, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const parsed = rows.map(r => ({
      jobId: r.jobId,
      status: r.status,
      amount: r.amount,
      taskInput: r.taskInput,
      taskResult: r.taskResult || null,
      createdAt: r.createdAt,
      txHash: r.txHash,
    }));
    res.json(parsed);
  });
});

app.get('/reputation', (req, res) => {
  res.json(getStats());
});

const PORT = process.env.PORT || 3001;
// Nanopayments-protected endpoint: pay a sub-cent fee via Circle Gateway
// for priority processing, separate from the main escrow flow.
const { createGatewayMiddleware } = require('@circle-fin/x402-batching/server');
const gateway = createGatewayMiddleware({ sellerAddress: process.env.WALLET_ADDRESS, facilitatorUrl: 'https://gateway-api-testnet.circle.com', networks: ['eip155:5042002'] });

app.get('/priority-status', gateway.require('$0.001'), (req, res) => {
  res.json({
    priority: true,
    message: 'Payment verified via Circle Gateway Nanopayments — priority access granted.',
  });
});

// Live demo endpoint: runs the FULL Nanopayments buyer flow server-side
// (deposit + sign + pay) using a dedicated raw wallet whose private key
// stays in this server's environment — never sent to the browser.
app.post('/nanopay-demo', async (req, res) => {
  try {
    const { GatewayClient } = require('@circle-fin/x402-batching/client');
    const client = new GatewayClient({
      chain: 'arcTestnet',
      privateKey: process.env.NANOPAY_BUYER_PRIVATE_KEY,
      rpcUrl: process.env.NANOPAY_RPC_URL,
    });
    const response = await client.pay(`http://localhost:${PORT}/priority-status`);
    const { recordTransaction } = require('./db');
    const jobId = '0xnano' + Date.now();
    recordTransaction(jobId, 'released', '0.001', 'Nanopayments priority access', response.data, null);
    res.json({ ok: true, result: response.data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Circle Agent Stack integration: verifies a real agent wallet created
// via `circle wallet create`, holding real USDC on Arc Testnet, funded
// through the CLI's own faucet command.
app.get('/agent-stack-wallet', (req, res) => {
  const { execSync } = require('child_process');
  const AGENT_STACK_ADDRESS = '0x8888106721ab9691c001193c141d538278ca5585';
  try {
    const output = execSync(
      `circle wallet balance --chain ARC-TESTNET --address ${AGENT_STACK_ADDRESS}`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    const lines = output.split('\n').filter(l => l.includes('false'));
    let balance = null;
    if (lines.length > 0) {
      const parts = lines[0].split('\u2502').map(p => p.trim()).filter(Boolean);
      balance = parts[2] || null;
    }
    res.json({
      ok: true,
      address: AGENT_STACK_ADDRESS,
      blockchain: 'ARC-TESTNET',
      balance: balance,
      raw: output,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Executes a real USDC payment from the Agent Stack wallet to the
// AgentPay client wallet, via Circle CLI directly — a live "onchain
// action" fulfilling Agent Stack's USDC payment requirement.
app.post('/agent-stack-payment', (req, res) => {
  const { execSync } = require('child_process');
  const AGENT_STACK_ADDRESS = '0x8888106721ab9691c001193c141d538278ca5585';
  const DEST_ADDRESS = process.env.WALLET_ADDRESS;
  const USDC_TOKEN = process.env.USDC_TOKEN_ADDRESS || '0x3600000000000000000000000000000000000000';
  const AMOUNT = '1';

  try {
    const output = execSync(
      `circle wallet transfer ${DEST_ADDRESS} --amount ${AMOUNT} --token ${USDC_TOKEN} --address ${AGENT_STACK_ADDRESS} --chain ARC-TESTNET --output json`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    const data = JSON.parse(output);
    res.json({ ok: true, amount: AMOUNT, to: DEST_ADDRESS, transaction: data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

// Keep-Alive ping every 5 minutes, to reduce Render free-tier cold starts
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(() => {
    fetch(RENDER_URL).catch(() => {});
  }, 5 * 60 * 1000);
}
