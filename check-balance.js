require('dotenv').config();
const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');

const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

async function checkBalance() {
  try {
    const response = await client.getWalletTokenBalance({
      id: process.env.WALLET_ID,
    });
    console.log('✅ رصيد المحفظة حاليًا:');
    console.log(response.data.tokenBalances);
  } catch (error) {
    console.error('❌ في مشكلة:', error.message);
  }
}

checkBalance();
