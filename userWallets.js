require('dotenv').config();
const fs = require('fs');
const path = require('path');
const client = require('./circleClient');

const USER_WALLET_SET_ID = process.env.USER_WALLET_SET_ID;
const USERS_FILE = path.join(__dirname, 'agentpay-users.json');

function loadUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

async function getOrCreateUserWallet(googleId, email) {
  const users = loadUsers();
  if (users[googleId]) {
    return { walletId: users[googleId].walletId, walletAddress: users[googleId].walletAddress };
  }

  const walletsRes = await client.createWallets({
    walletSetId: USER_WALLET_SET_ID,
    blockchains: ['ARC-TESTNET'],
    count: 1,
    accountType: 'SCA',
  });
  const w = walletsRes.data.wallets[0];

  users[googleId] = {
    email,
    walletId: w.id,
    walletAddress: w.address,
    createdAt: new Date().toISOString(),
    hasSeenWelcome: false,
  };
  saveUsers(users);

  return { walletId: w.id, walletAddress: w.address };
}

function hasSeenWelcome(googleId) {
  const users = loadUsers();
  return users[googleId] ? !!users[googleId].hasSeenWelcome : false;
}

function markWelcomeSeen(googleId) {
  const users = loadUsers();
  if (users[googleId]) {
    users[googleId].hasSeenWelcome = true;
    saveUsers(users);
  }
}

module.exports = { getOrCreateUserWallet, hasSeenWelcome, markWelcomeSeen };
