require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const { generateEntitySecretCiphertext } = require('@circle-fin/developer-controlled-wallets');

async function deployContract() {
  const abi = JSON.parse(fs.readFileSync('contract-abi.json', 'utf8'));
  const bytecode = fs.readFileSync('contract-bytecode.txt', 'utf8').trim();

  const entitySecretCiphertext = await generateEntitySecretCiphertext({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });

  const idempotencyKey = crypto.randomBytes(16).toString('hex');

  const body = {
    idempotencyKey,
    entitySecretCiphertext,
    name: 'AgentPayEscrow',
    description: 'AgentPay_Escrow_OnChain',
    walletId: process.env.WALLET_ID,
    blockchain: 'ARC-TESTNET',
    abiJson: JSON.stringify(abi),
    bytecode: bytecode,
    constructorParameters: [
      '0x3600000000000000000000000000000000000000', // Arc Testnet USDC
      process.env.WALLET_ADDRESS // owner explicitly set to avoid the ownership bug
    ],
    feeLevel: 'MEDIUM',
  };

  console.log('📤 Sending deploy request...');
  const res = await fetch('https://api.circle.com/v1/w3s/contracts/deploy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log('Status:', res.status);
  console.log('Response:', JSON.stringify(data, null, 2));
}

deployContract().catch(err => console.error('❌ Script error:', err));
