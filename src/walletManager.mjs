/**
 * @license
 * Graveyard Protocol CLI
 * Copyright (c) 2026 Graveyard Protocol. All rights reserved.
 * This software and its source code are proprietary. 
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import inquirer from 'inquirer';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const STORAGE_DIR = path.join(os.homedir(), '.gp-cli');
const STORAGE_FILE = path.join(STORAGE_DIR, 'wallets.json');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

// Load wallet file
function loadWalletFile() {
  if (!fs.existsSync(STORAGE_FILE)) return { wallets: [] };
  return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
}

// Save wallet file
function saveWalletFile(data) {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Generate AES-256 key from password
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

// Encrypt private key
function encryptPrivateKey(privateKey, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    salt: salt.toString('hex'),
    tag
  };
}

// Decrypt private key
function decryptPrivateKey(encryptedObj, password) {
  const { encrypted, iv, salt, tag } = encryptedObj;
  const key = deriveKey(password, Buffer.from(salt, 'hex'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Detect inquirer's ExitPromptError (thrown on Ctrl+C in v9+) without
// importing the class directly — checking the name is sufficient.
function isExitPrompt(err) {
  return err?.name === 'ExitPromptError';
}

// Add wallet
async function addWallet() {
  let answers;
  try {
    answers = await inquirer.prompt([
      {
        type: 'password',
        name: 'privateKey',
        message: 'Enter wallet private key (JSON byte array [1,2,..] or Base58 string):',
        mask: '*',
      },
      {
        type: 'input',
        name: 'description',
        message: 'Enter a description for this wallet (e.g. "Main wallet", "Trading wallet"):',
        validate: (input) => input.trim().length > 0 ? true : 'Description cannot be empty.',
      },
      {
        type: 'password',
        name: 'password',
        message: 'Enter password to encrypt wallet:',
        mask: '*',
      },
      {
        type: 'password',
        name: 'passwordConfirm',
        message: 'Confirm password:',
        mask: '*',
      },
    ]);
  } catch (err) {
    if (isExitPrompt(err)) { console.log('\nAborted.'); process.exit(0); }
    throw err;
  }

  if (answers.password !== answers.passwordConfirm) {
    console.log('Passwords do not match.');
    return;
  }

  const { description, privateKey, password } = answers;

  // ── Support JSON byte array [1,2,3...] AND Base58 string ─────────────────
  let keypair;
  let normalizedKey; // always stored as JSON array string

  const trimmed = privateKey.trim();

  if (trimmed.startsWith('[')) {
    // JSON byte array — Phantom / Solflare export
    let bytes;
    try {
      bytes = JSON.parse(trimmed);
    } catch {
      console.log('Invalid private key: could not parse JSON byte array.');
      return;
    }
    if (!Array.isArray(bytes) || bytes.length !== 64) {
      console.log('Invalid private key: expected a 64-element byte array.');
      return;
    }
    try {
      keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
    } catch {
      console.log('Invalid private key bytes.');
      return;
    }
    normalizedKey = JSON.stringify(bytes);
  } else {
    // Base58 string
    try {
      const decoded = bs58.decode(trimmed);
      if (decoded.length !== 64) {
        console.log('Invalid Base58 private key: expected a 64-byte keypair (88 characters). Some wallets export a 32-byte seed — use the full keypair export instead.');
        return;
      }
      keypair = Keypair.fromSecretKey(decoded);
      normalizedKey = JSON.stringify(Array.from(decoded));
    } catch (err) {
      console.log(`Invalid private key: ${err.message}`);
      return;
    }
  }

  const publicKey = keypair.publicKey.toBase58();
  const walletFile = loadWalletFile();

  // Prevent duplicate
  if (walletFile.wallets.find(w => w.publicKey === publicKey)) {
    console.log(`Wallet ${publicKey} is already saved.`);
    return;
  }

  const encryptedObj = encryptPrivateKey(normalizedKey, password);

  walletFile.wallets.push({
    description: description.trim(),
    publicKey,
    encryptedPrivateKey: encryptedObj,
  });

  saveWalletFile(walletFile);
  console.log(`\nWallet added successfully.`);
  console.log(`  Description : ${description.trim()}`);
  console.log(`  Public key  : ${publicKey}`);
  console.log(`\n⚠  Important: Note down your password. It is required every time you`);
  console.log(`   run close-empty command with this wallet. If you forget it, you can remove`);
  console.log(`   and re-add this wallet without any impact on your funds or previous history.\n`);
}

// Remove wallet
async function removeWallet() {
  const walletFile = loadWalletFile();
  if (!walletFile.wallets.length) {
    console.log('No wallets found.');
    return;
  }

  let answers;
  try {
    answers = await inquirer.prompt([
      {
        type: 'rawlist',
        name: 'wallet',
        message: 'Select wallet to remove:',
        choices: walletFile.wallets.map((w, i) => ({
          name: `${w.description || 'No description'}  (${w.publicKey})`,
          value: w.publicKey,
        })),
      }
    ]);
  } catch (err) {
    if (isExitPrompt(err)) { console.log('\nAborted.'); process.exit(0); }
    throw err;
  }

  walletFile.wallets = walletFile.wallets.filter(w => w.publicKey !== answers.wallet);
  saveWalletFile(walletFile);
  console.log(`Wallet ${answers.wallet} removed successfully.`);
}

// Load and decrypt wallet (returns keypair)
async function loadWallet(publicKey) {
  const walletFile = loadWalletFile();
  const walletEntry = walletFile.wallets.find(w => w.publicKey === publicKey);
  if (!walletEntry) throw new Error('Wallet not found');

  let answers;
  try {
    answers = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: `Enter password to unlock wallet "${walletEntry.description || publicKey}":`,
        mask: '*'
      }
    ]);
  } catch (err) {
    if (isExitPrompt(err)) { console.log('\nAborted.'); process.exit(0); }
    throw err;
  }

  const decryptedKey = decryptPrivateKey(walletEntry.encryptedPrivateKey, answers.password);
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(decryptedKey)));
  return keypair;
}

// List wallets
function listWallets() {
  const walletFile = loadWalletFile();
  if (!walletFile.wallets.length) {
    console.log('No wallets stored.');
    return;
  }
  console.log('\nStored wallets:');
  console.log('─'.repeat(60));
  walletFile.wallets.forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.description || 'No description'}`);
    console.log(`     ${w.publicKey}`);
  });
  console.log('─'.repeat(60));
  console.log('');
}

// ── Wallet selection prompt ───────────────────────────────────────────────────

async function selectWallet(walletFile) {
  if (!walletFile.wallets.length) {
    throw new Error('No wallets saved. Run `gp add-wallet` first.');
  }
  let result;
  try {
    result = await inquirer.prompt([
      {
        type: 'rawlist',
        name: 'selected',
        message: 'Select a wallet to use:',
        choices: walletFile.wallets.map((w) => ({
          name: `${w.description || 'No description'}  (${w.publicKey})`,
          value: w.publicKey,
        })),
      },
    ]);
  } catch (err) {
    if (isExitPrompt(err)) { console.log('\nAborted.'); process.exit(0); }
    throw err;
  }

  return result.selected;
}

export {
  addWallet,
  removeWallet,
  loadWallet,
  loadWalletFile,
  listWallets,
  selectWallet
};

