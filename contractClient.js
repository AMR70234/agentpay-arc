require('dotenv').config();
const crypto = require('crypto');
const { generateEntitySecretCiphertext } = require('@circle-fin/developer-controlled-wallets');

const CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS;

async function callContract({ walletId, contractAddress, abiFunctionSignature, abiParameters }) {
  const targetAddress = contractAddress || CONTRACT_ADDRESS;
  const entitySecretCiphertext = await generateEntitySecretCiphertext({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });

  const res = await fetch('https://api.circle.com/v1/w3s/developer/transactions/contractExecution', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`,
    },
    body: JSON.stringify({
      idempotencyKey: crypto.randomUUID(),
      entitySecretCiphertext,
      walletId,
      contractAddress: targetAddress,
      abiFunctionSignature,
      abiParameters,
      feeLevel: 'MEDIUM',
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Contract call failed: ${JSON.stringify(data)}`);
  return data;
}

function pollTransaction(txId, maxTries = 10) {
  return new Promise(async (resolve) => {
    for (let i = 0; i < maxTries; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const res = await fetch(`https://api.circle.com/v1/w3s/transactions/${txId}`, {
        headers: { 'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}` },
      });
      const data = await res.json();
      const state = data.data.transaction.state;
      if (state === 'COMPLETE' || state === 'FAILED') {
        resolve(data.data.transaction);
        return;
      }
    }
    resolve({ state: 'TIMEOUT' });
  });
}

module.exports = { callContract, pollTransaction, CONTRACT_ADDRESS };
