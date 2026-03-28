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

const STORAGE_DIR  = path.join(os.homedir(), '.gp-cli');
const STORAGE_FILE = path.join(STORAGE_DIR, 'wallets.json');

if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────────────────────────────────────

export function loadWalletFile() {
  if (!fs.existsSync(STORAGE_FILE)) return { wallets: [] };
  return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
}

function saveWalletFile(data) {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Crypto helpers  (used only for encrypted wallets)
// ─────────────────────────────────────────────────────────────────────────────

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

function encryptPrivateKey(normalizedKey, password) {
  const salt    = crypto.randomBytes(16);
  const iv      = crypto.randomBytes(12);
  const key     = deriveKey(password, salt);
  const cipher  = crypto.createCipheriv('aes-256-gcm', key, iv);
  let   enc     = cipher.update(normalizedKey, 'utf8', 'hex');
  enc          += cipher.final('hex');
  const tag     = cipher.getAuthTag().toString('hex');
  return { encrypted: enc, iv: iv.toString('hex'), salt: salt.toString('hex'), tag };
}

function decryptPrivateKey(encryptedObj, password) {
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
//
// Accepts any of:
//   1. JSON byte-array string   "[1,2,3,…]"
//   2. Base58 string            "5Jxyz…"
//   3. Path to a keypair file   "/path/to/id.json"  (Solana standard format —
//                               file must contain a JSON array of 64 numbers)
//
// Returns { keypair, normalizedKey } where normalizedKey is always the
// canonical "[1,2,3,…]" JSON-array string used for storage.
// ─────────────────────────────────────────────────────────────────────────────

function parsePrivateKey(raw) {
  const trimmed = raw.trim();

  // ── Path heuristic ─────────────────────────────────────────────────────────
  // Treat input as a file path if it starts with /, ~, ./, ../ or ends with .json
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

  // ── JSON byte-array string ─────────────────────────────────────────────────
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

  // ── Base58 string ──────────────────────────────────────────────────────────
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
// Wallet entry schema
// ───────────────────
//
//   Encrypted  (default, human-friendly):
//   {
//     "encrypted": true,
//     "name": "…",
//     "publicKey": "…",
//     "encryptedPrivateKey": { "encrypted": "…", "iv": "…", "salt": "…", "tag": "…" }
//   }
//
//   Unencrypted  (--no-pwd, agent-friendly):
//   {
//     "encrypted": false,
//     "name": "…",
//     "publicKey": "…",
//     "privateKey": "[1,2,3,…]"
//   }
//
// Key input  (resolved in priority order):
//   1. --keypair-file <path>   path to Solana keypair JSON file
//   2. --private-key <value>   inline Base58 string or JSON-array string
//   3. interactive prompt      (human fallback)
//
// Encryption:
//   default          → prompts for password  → encrypted: true
//   --no-pwd     → stores key plaintext  → encrypted: false  (no password prompt)
//
// Agent one-liner examples:
//   gp add-wallet --keypair-file ~/.config/solana/id.json \
//                 --no-pwd \
//                 --name "Bot wallet"
//
//   gp add-wallet --private-key "5Jxyz…" \
//                 --no-pwd \
//                 --name "Hot wallet"
// ─────────────────────────────────────────────────────────────────────────────

export async function addWallet(options = {}) {

  // ── 1. Resolve raw key input ───────────────────────────────────────────────
  let privateKeyRaw;

  if (options.keypairFile) {
    // Flag value is always treated as a file path — no heuristics needed
    const resolved = options.keypairFile.startsWith('~')
      ? path.join(os.homedir(), options.keypairFile.slice(1))
      : path.resolve(options.keypairFile);
    privateKeyRaw = resolved;

  } else if (options.privateKey) {
    privateKeyRaw = options.privateKey;

  } else {
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
    console.log(err.message);
    return;
  }

  const publicKey  = keypair.publicKey.toBase58();
  const walletFile = loadWalletFile();

  if (walletFile.wallets.find(w => w.publicKey === publicKey)) {
    console.log(`Wallet ${publicKey} is already saved.`);
    return;
  }

  // ── 3. Resolve Name ─────────────────────────────────────────────────
  let name;
  if (options.name) {
    name = options.name.trim();
  } else {
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

  // ── 4. Encrypt or store plaintext ──────────────────────────────────────────
  // const noPwd = Boolean(options.noPwd);
  const noPwd = options.pwd === false;  // Commander sets .pwd for --no-pwd
  let entry;

  if (noPwd) {
    entry = {
      encrypted:   false,
      name: name.trim(),
      publicKey,
      privateKey:  normalizedKey,
    };
  } else {
    // Interactive password prompt (human mode)
    let ans;
    try {
      ans = await inquirer.prompt([
        {
          type: 'password', name: 'password',
          message: 'Enter password to encrypt wallet:', mask: '*',
        },
        {
          type: 'password', name: 'passwordConfirm',
          message: 'Confirm password:', mask: '*',
        },
      ]);
    } catch (err) {
      if (isExitPrompt(err)) { console.log('\nAborted.'); process.exit(0); }
      throw err;
    }
    if (ans.password !== ans.passwordConfirm) {
      console.log('Passwords do not match.');
      return;
    }
    entry = {
      encrypted:           true,
      name:         name.trim(),
      publicKey,
      encryptedPrivateKey: encryptPrivateKey(normalizedKey, ans.password),
    };
  }

  walletFile.wallets.push(entry);
  saveWalletFile(walletFile);

  const lockLabel = noPwd ? 'unencrypted' : 'encrypted';
  console.log(`\nWallet added successfully  (${lockLabel})`);
  console.log(`  Name : ${name.trim()}`);
  console.log(`  Public key  : ${publicKey}`);

  if (!noPwd) {
    console.log(`\nImportant: Note down your password. It is required every time you`);
    console.log(`   run close-empty with this wallet. If you forget it, remove and re-add`);
    console.log(`   the wallet — your funds and history are unaffected.\n`);
  } else {
    console.log(`\nThis wallet's private key is stored without encryption.`);
    console.log(`Ensure ${STORAGE_FILE} has appropriate file-system permissions.\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// removeWallet
//
// Agent: --wallet <address> skips the interactive picker.
// ─────────────────────────────────────────────────────────────────────────────

export async function removeWallet(options = {}) {
  const walletFile = loadWalletFile();
  if (!walletFile.wallets.length) {
    console.log('No wallets found.');
    return;
  }

  let walletAddress;

  if (options.wallet) {
    walletAddress = options.wallet;
  } else {
    let ans;
    try {
      ans = await inquirer.prompt([
        {
          type:    'rawlist',
          name:    'wallet',
          message: 'Select wallet to remove:',
          choices: walletFile.wallets.map(w => ({
            name:  `${w.encrypted === false ? '🔓' : '🔒'} ${w.name || 'No Name'}  (${w.publicKey})`,
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
    console.log(`Wallet ${walletAddress} not found in local storage.`);
    return;
  }

  walletFile.wallets = walletFile.wallets.filter(w => w.publicKey !== walletAddress);
  saveWalletFile(walletFile);
  console.log(`Wallet ${walletAddress} removed successfully.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// loadWallet
//
// Branches on entry.encrypted:
//
//   false  → returns Keypair immediately — no prompt, no password.
//            This makes unencrypted wallets fully agent-transparent; callers
//            (close-empty, etc.) do not need to know about encryption at all.
//
//   true   → prompts interactively for password → AES-256-GCM decrypt → Keypair
//   (or legacy entries without the field — treated as encrypted)
// ─────────────────────────────────────────────────────────────────────────────

export async function loadWallet(publicKey) {
  const walletFile = loadWalletFile();
  const entry      = walletFile.wallets.find(w => w.publicKey === publicKey);
  if (!entry) throw new Error(`Wallet not found: ${publicKey}`);

  // ── Unencrypted ────────────────────────────────────────────────────────────
  if (entry.encrypted === false) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(entry.privateKey)));
    } catch {
      throw new Error('Wallet entry is corrupted — private key could not be parsed.');
    }
  }

  // ── Encrypted  (entry.encrypted === true  or  legacy entry without field) ──
  let ans;
  try {
    ans = await inquirer.prompt([
      {
        type:    'password',
        name:    'password',
        message: `Enter password to unlock wallet "${entry.name || publicKey}":`,
        mask:    '*',
      },
    ]);
  } catch (err) {
    if (isExitPrompt(err)) { console.log('\nAborted.'); process.exit(0); }
    throw err;
  }

  try {
    const decryptedKey = decryptPrivateKey(entry.encryptedPrivateKey, ans.password);
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(decryptedKey)));
  } catch {
    throw new Error('Failed to decrypt wallet — incorrect password or corrupted entry.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// listWallets — shows 🔒/🔓 alongside each entry
// ─────────────────────────────────────────────────────────────────────────────

export function listWallets() {
  const walletFile = loadWalletFile();
  if (!walletFile.wallets.length) {
    console.log('No wallets stored.');
    return;
  }
  console.log('\nStored wallets:');
  console.log('─'.repeat(56));
  walletFile.wallets.forEach((w, i) => {
    // const lock = w.encrypted === false ? '🔓 unencrypted' : '🔒 encrypted  ';
    // console.log(`  ${i + 1}. [${lock}]  ${w.name || 'No Name'}`);
    console.log(`  ${i + 1}. ${w.name || 'No Name'}`);
    console.log(`     ${w.publicKey}`);
  });
  console.log('─'.repeat(56));
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// selectWallet — interactive picker used by close-empty / stats
// ─────────────────────────────────────────────────────────────────────────────

export async function selectWallet(walletFile) {
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
          name:  `${w.encrypted === false ? '🔓' : '🔒'} ${w.name || 'No Name'}  (${w.publicKey})`,
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
