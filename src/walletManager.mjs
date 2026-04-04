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
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { STORAGE_DIR, STORAGE_FILE } from './config.mjs';

if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────────────────────────────────────

export function loadWalletFile() {
  if (!fs.existsSync(STORAGE_FILE)) return { wallets: [] };
  return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
}

export function saveWalletFile(fileName, data) {
  fs.writeFileSync(fileName, JSON.stringify(data, null, 2), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON output helper
// ─────────────────────────────────────────────────────────────────────────────

function jsonExit(payload, code = 0) {
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exitCode = code;
}

// ─────────────────────────────────────────────────────────────────────────────
// Crypto helpers
// ─────────────────────────────────────────────────────────────────────────────

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

export function encryptPrivateKey(normalizedKey, password) {
  const salt    = crypto.randomBytes(16);
  const iv      = crypto.randomBytes(12);
  const key     = deriveKey(password, salt);
  const cipher  = crypto.createCipheriv('aes-256-gcm', key, iv);
  let   enc     = cipher.update(normalizedKey, 'utf8', 'hex');
  enc          += cipher.final('hex');
  const tag     = cipher.getAuthTag().toString('hex');
  return { encrypted: enc, iv: iv.toString('hex'), salt: salt.toString('hex'), tag };
}

export function decryptPrivateKey(encryptedObj, password) {
  const { encrypted, iv, salt, tag } = encryptedObj;
  const key      = deriveKey(password, Buffer.from(salt, 'hex'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let dec  = decipher.update(encrypted, 'hex', 'utf8');
  dec     += decipher.final('utf8');
  return dec;
}

// ─────────────────────────────────────────────────────────────────────────────
// Private-key parsing
// ─────────────────────────────────────────────────────────────────────────────

function parsePrivateKey(raw) {
  const trimmed = raw.trim();

  const looksLikePath =
    trimmed.startsWith('/') ||
    trimmed.startsWith('~') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    (trimmed.endsWith('.json') && !trimmed.startsWith('['));

  if (looksLikePath) {
    const resolved = trimmed.startsWith('~')
      ? path.join(os.homedir(), trimmed.slice(1))
      : path.resolve(trimmed);

    if (!fs.existsSync(resolved)) {
      throw new Error(`Keypair file not found: ${resolved}`);
    }

    let fileText;
    try { fileText = fs.readFileSync(resolved, 'utf8'); } catch (e) {
      throw new Error(`Cannot read keypair file: ${e.message}`);
    }

    let bytes;
    try { bytes = JSON.parse(fileText); } catch {
      throw new Error(`Keypair file is not valid JSON: ${resolved}`);
    }

    if (!Array.isArray(bytes) || bytes.length !== 64) {
      throw new Error(
        `Keypair file must contain a 64-element byte array ` +
        `(got ${Array.isArray(bytes) ? bytes.length : typeof bytes} in ${resolved})`
      );
    }

    const keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
    return { keypair, normalizedKey: JSON.stringify(bytes) };
  }

  if (trimmed.startsWith('[')) {
    let bytes;
    try { bytes = JSON.parse(trimmed); } catch {
      throw new Error('Invalid private key: could not parse JSON byte array.');
    }
    if (!Array.isArray(bytes) || bytes.length !== 64) {
      throw new Error(
        `Invalid private key: expected a 64-element byte array ` +
        `(got ${Array.isArray(bytes) ? bytes.length : typeof bytes}).`
      );
    }
    const keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
    return { keypair, normalizedKey: JSON.stringify(bytes) };
  }

  try {
    const decoded = bs58.decode(trimmed);
    if (decoded.length !== 64) {
      throw new Error(
        `Invalid Base58 private key: expected 64 bytes, got ${decoded.length}. ` +
        `Some wallets export a 32-byte seed — use the full keypair export instead.`
      );
    }
    const keypair = Keypair.fromSecretKey(decoded);
    return { keypair, normalizedKey: JSON.stringify(Array.from(decoded)) };
  } catch (err) {
    if (err.message.startsWith('Invalid')) throw err;
    throw new Error(`Invalid private key: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ExitPromptError guard
// ─────────────────────────────────────────────────────────────────────────────

function isExitPrompt(err) {
  return err?.name === 'ExitPromptError';
}

// ─────────────────────────────────────────────────────────────────────────────
// addWallet
//
// JSON output schema:
//   { "success": true,  "publicKey": "…", "name": "…" }
//   { "success": false, "error": "…" }
// ─────────────────────────────────────────────────────────────────────────────

export async function addWallet(options = {}) {
  let inquirer;
  const jsonMode = Boolean(options.json);

  // ── Enforce password requirement ──────────────────────────────────────────
  const cliKey = process.env.GP_CLI_MASTER_KEY;

  if (!cliKey) {
    const msg = 'gp-cli is not initialized. Run `gp init` before adding wallets.';
    if (jsonMode) {
      jsonExit({ success: false, error: msg }, 1);
      return;
    }
    console.log(`\n  ✖ ${msg}\n`);
    return;
  }

  if (!jsonMode) {
    const mod = await import('inquirer');
    inquirer = mod.default;
  }

  // ── 1. Resolve raw key input ───────────────────────────────────────────────
  let privateKeyRaw;

  if (options.keypairFile) {
    const resolved = options.keypairFile.startsWith('~')
      ? path.join(os.homedir(), options.keypairFile.slice(1))
      : path.resolve(options.keypairFile);
    privateKeyRaw = resolved;

  } else if (options.privateKey) {
    privateKeyRaw = options.privateKey;

  } else {
    if (jsonMode) {
      jsonExit({ success: false, error: 'JSON mode requires --keypair-file or --private-key' }, 1);
      return;
    }
    let ans;
    try {
      ans = await inquirer.prompt([
        {
          type:    'password',
          name:    'privateKey',
          message: 'Enter private key (JSON array, Base58 string, or /path/to/keypair.json):',
          mask:    '*',
        },
      ]);
    } catch (err) {
      if (isExitPrompt(err)) { console.log('\nAborted.'); process.exit(0); }
      throw err;
    }
    privateKeyRaw = ans.privateKey;
  }

  // ── 2. Parse + validate ────────────────────────────────────────────────────
  let keypair, normalizedKey;
  try {
    ({ keypair, normalizedKey } = parsePrivateKey(privateKeyRaw));
  } catch (err) {
    if (jsonMode) {
      jsonExit({ success: false, error: err.message }, 1);
      return;
    }
    console.log(err.message);
    return;
  }

  const publicKey  = keypair.publicKey.toBase58();
  const walletFile = loadWalletFile();

  if (walletFile.wallets.find(w => w.publicKey === publicKey)) {
    if (jsonMode) {
      jsonExit({ success: false, error: `Wallet ${publicKey} is already saved.` }, 1);
      return;
    }
    console.log(`Wallet ${publicKey} is already saved.`);
    return;
  }

  // ── 3. Resolve Name ────────────────────────────────────────────────────────
  let name;
  if (options.name) {
    name = options.name.trim();
  } else {
    if (jsonMode) {
      jsonExit({ success: false, error: 'JSON mode requires --name <label>' }, 1);
      return;
    }
    let ans;
    try {
      ans = await inquirer.prompt([
        {
          type:     'input',
          name:     'name',
          message:  'Enter a Name for this wallet (e.g. "Main wallet"):',
          validate: (v) => v.trim().length > 0 ? true : 'Name cannot be empty.',
        },
      ]);
    } catch (err) {
      if (isExitPrompt(err)) { console.log('\nAborted.'); process.exit(0); }
      throw err;
    }
        name = ans.name;
  }

  if (walletFile.wallets.find(w => w.name === name)) {
    if (jsonMode) {
      jsonExit({ success: false, error: `Wallet ${name} is already saved.` }, 1);
      return;
    }
    console.log(`Wallet name - ${name} is already used.`);
    return;
  }

  // ── 4. Encrypt using the stored CLI password ───────────────────────────────
  const entry = {
    name:                name.trim(),
    publicKey,
    encryptedPrivateKey: encryptPrivateKey(normalizedKey, cliKey),
  };

  walletFile.wallets.push(entry);
  saveWalletFile(STORAGE_FILE, walletFile);

  if (jsonMode) {
    jsonExit({ success: true, publicKey, name: name.trim() });
    return;
  }

  console.log(`\nWallet added successfully.`);
  console.log(`  Name       : ${name.trim()}`);
  console.log(`  Public key : ${publicKey}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// removeWallet
//
// JSON output schema:
//   { "success": true,  "publicKey": "…" }
//   { "success": false, "error": "…" }
// ─────────────────────────────────────────────────────────────────────────────

export async function removeWallet(options = {}) {
  let inquirer;
  const jsonMode = Boolean(options.json);

  if (!jsonMode) {
    const mod = await import('inquirer');
    inquirer = mod.default;
  }

  const walletFile = loadWalletFile();

  if (!walletFile.wallets.length) {
    if (jsonMode) {
      jsonExit({ success: false, error: 'No wallets found.' }, 1);
      return;
    }
    console.log('No wallets found.');
    return;
  }

  let walletAddress;

  if (options.wallet) {
    walletAddress = options.wallet;
  } else {
    if (jsonMode) {
      jsonExit({ success: false, error: 'JSON mode requires --wallet <address>' }, 1);
      return;
    }
    let ans;
    try {
      ans = await inquirer.prompt([
        {
          type:    'rawlist',
          name:    'wallet',
          message: 'Select wallet to remove:',
          choices: walletFile.wallets.map(w => ({
            name:  `${w.name || 'No Name'}  (${w.publicKey})`,
            value: w.publicKey,
          })),
        },
      ]);
    } catch (err) {
      if (isExitPrompt(err)) { console.log('\nAborted.'); process.exit(0); }
      throw err;
    }
    walletAddress = ans.wallet;
  }

  if (!walletFile.wallets.find(w => w.publicKey === walletAddress)) {
    if (jsonMode) {
      jsonExit({ success: false, error: `Wallet ${walletAddress} not found in local storage.` }, 1);
      return;
    }
    console.log(`Wallet ${walletAddress} not found in local storage.`);
    return;
  }

  walletFile.wallets = walletFile.wallets.filter(w => w.publicKey !== walletAddress);
  saveWalletFile(STORAGE_FILE, walletFile);

  if (jsonMode) {
    jsonExit({ success: true, publicKey: walletAddress });
    return;
  }
  console.log(`Wallet ${walletAddress} removed successfully.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// listWallets
//
// JSON output schema:
//   {
//     "success": true,
//     "wallets": [
//       { "publicKey": "…", "name": "…", "encrypted": true }
//     ]
//   }
// ─────────────────────────────────────────────────────────────────────────────

export function listWallets(options = {}) {
  const jsonMode = Boolean(options?.json);
  const walletFile = loadWalletFile();

  if (jsonMode) {
    jsonExit({
      success: true,
      wallets: walletFile.wallets.map(w => ({
        publicKey: w.publicKey,
        name:      w.name || '',
      })),
    });
    return;
  }

  if (!walletFile.wallets.length) {
    console.log('No wallets stored.');
    return;
  }
  console.log('\nStored wallets:');
  console.log('─'.repeat(56));
  walletFile.wallets.forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.name || 'No Name'}`);
    console.log(`     ${w.publicKey}`);
  });
  console.log('─'.repeat(56));
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// loadWallet
// ─────────────────────────────────────────────────────────────────────────────

export async function loadWallet(publicKey) {
  const walletFile = loadWalletFile();
  const entry      = walletFile.wallets.find(w => w.publicKey === publicKey);
  if (!entry) throw new Error(`Wallet not found: ${publicKey}`);

  const cliKey = process.env.GP_CLI_MASTER_KEY;
  if (!cliKey) {
    throw new Error('gp-cli is not initialized. Run `gp init` to configure it.');
  }

  try {
    const decryptedKey = decryptPrivateKey(entry.encryptedPrivateKey, cliKey);
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(decryptedKey)));
  } catch {
    throw new Error(
      'Failed to decrypt wallet — the wallet entry is corrupted. ' +
      'Remove and re-add the wallet`.'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// selectWallet — interactive picker
// ─────────────────────────────────────────────────────────────────────────────

export async function selectWallet(walletFile, inquirer) {
  if (!walletFile.wallets.length) {
    throw new Error('No wallets saved. Run `gp add-wallet` first.');
  }
  let result;
  try {
    result = await inquirer.prompt([
      {
        type:    'rawlist',
        name:    'selected',
        message: 'Select a wallet to use:',
        choices: walletFile.wallets.map(w => ({
          name:  `${w.name || 'No Name'}  (${w.publicKey})`,
          value: w.publicKey,
        })),
      },
    ]);
  } catch (err) {
    if (err?.name === 'ExitPromptError') { console.log('\nAborted.'); process.exit(0); }
    throw err;
  }
  return result.selected;
}
