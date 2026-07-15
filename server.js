require('dotenv').config();
const express = require('express');
const cors = require('cors');
const client = require('./circleClient');
const { executeTask } = require('./task');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const USDC_TOKEN_ID = 'ef87c8c3-85de-598a-af50-c5135eecfa74';

app.post('/run-job', async (req, res) => {
  const { taskInput, amount } = req.body;

  if (!taskInput) {
    return res.status(400).json({ error: 'Missing taskInput in request body' });
  }

  try {
    console.log('🚀 Job started...');
    const taskResult = await executeTask(taskInput);

    if (taskResult.accepted) {
      console.log('✅ Task accepted, transferring payment...');

      const transferResponse = await client.createTransaction({
        walletId: process.env.WALLET_ID,
        tokenId: USDC_TOKEN_ID,
        destinationAddress: process.env.WORKER_WALLET_ADDRESS,
        amount: [amount ? String(amount) : '1'],
        fee: {
          type: 'level',
          config: { feeLevel: 'MEDIUM' },
        },
      });

      return res.json({
        accepted: true,
        summary: taskResult.result,
        transaction: transferResponse.data,
      });
    } else {
      return res.json({
        accepted: false,
        summary: taskResult.result,
      });
    }
  } catch (error) {
    console.error('❌ Error in /run-job:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/balances', async (req, res) => {
  try {
    const [clientBal, workerBal] = await Promise.all([
      client.getWalletTokenBalance({ id: process.env.WALLET_ID }),
      client.getWalletTokenBalance({ id: process.env.WORKER_WALLET_ID }),
    ]);

    const getUsdc = (balanceResponse) => {
      const token = balanceResponse.data.tokenBalances.find(t => !t.token.isNative);
      return token ? token.amount : '0';
    };

    res.json({
      client: getUsdc(clientBal),
      worker: getUsdc(workerBal),
    });
  } catch (error) {
    console.error('❌ Error in /balances:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
