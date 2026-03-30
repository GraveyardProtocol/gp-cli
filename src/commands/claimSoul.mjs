/**
 * @license
 * Graveyard Protocol CLI
 * Copyright (c) 2026 Graveyard Protocol. All rights reserved.
 * This software and its source code are proprietary.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import { loadWalletFile, selectWallet } from '../walletManager.mjs';
import { getEpochData, claimSoul } from '../api.mjs';
import {
  printBanner,
  printHeader,
  printError,
  printInfo,
  printWarning,
  printSuccess,
} from '../display.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isExitPrompt(err) {
  return err?.name === 'ExitPromptError';
}

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  grey:   '\x1b[90m',
  white:  '\x1b[37m',
  red:    '\x1b[31m',
};
const c = (color, text) => `${C[color]}${text}${C.reset}`;

/** Emit JSON to stdout and exit. */
function jsonExit(payload, code = 0) {
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exitCode=code;
}

function formatEpochDate(yyyymmdd) {
  const s = String(yyyymmdd);
  const year  = parseInt(s.slice(0, 4), 10);
  const month = parseInt(s.slice(4, 6), 10) - 1;
  const day   = parseInt(s.slice(6, 8), 10);
  const d = new Date(Date.UTC(year, month, day));
  const end = new Date(d);
  end.setUTCDate(d.getUTCDate() + 6);
  const fmt = (dt) => dt.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  return `${fmt(d)} → ${fmt(end)}`;
}

// ── Print previous-epoch SOUL summary before confirmation ─────────────────────

function printClaimSummary(walletAddress, epoch) {
  const userGhost = (Number(epoch.userGhostEarned) + Number(epoch.userGhostReferrals));
  const ghostShare = epoch.totalGhostEarned > 0
    ? ((userGhost / epoch.totalGhostEarned) * 100).toFixed(4) + '%'
    : '—';

  console.log('');
  console.log(c('bold', '  Previous Epoch — Claimable SOUL'));
  console.log(c('grey',  '  ──────────────────────────────────────'));
  console.log(`  Wallet           : ${c('dim', walletAddress)}`);
  console.log(`  Epoch period     : ${c('white', formatEpochDate(epoch.epochStartDate))}`);
  console.log(`  Accounts closed  : ${c('yellow', epoch.userAccountsClosed.toLocaleString())}`);
  console.log(`  SOL earned       : ${c('green',  epoch.userSolsRecovered.toFixed(6))} SOL`);
  console.log(`  Ghost Points     : ${c('cyan',   userGhost.toLocaleString())} (${ghostShare} of epoch)`);
  console.log(`  ${c('bold', 'SOUL to claim')}  : ${c('green', Number(epoch.userSoul).toFixed(6))} SOUL`);
  console.log('');
}

// ── Claim for a single wallet ─────────────────────────────────────────────────

/**
 * Returns a result object:
 *   { wallet, status, soulClaimed?, txSignature?, epochStartDate? }
 *
 * status values:
 *   "claimed"        — successful on-chain claim
 *   "dry_run"        — dry-run preview only
 *   "already_claimed"— claimState === 'Yes'
 *   "in_progress"    — claimState === 'Claiming'
 *   "no_soul"        — nothing to claim this epoch
 *   "no_epoch"       — no previous epoch data
 *   "aborted"        — user declined the interactive confirm
 *   "error"          — unexpected failure (check .error field)
 */
async function claimForWallet(walletAddress, options, jsonMode = false, inquirer) {
  if (!jsonMode) printHeader(`Claim SOUL: ${walletAddress}`);
  if (!jsonMode) printInfo('Fetching epoch data...');

  let epochData;
  try {
    epochData = await getEpochData(walletAddress);
  } catch (err) {
    return { wallet: walletAddress, status: 'error', error: `Failed to fetch epoch data: ${err.message}` };
  }

  const { previousEpoch } = epochData;

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!previousEpoch) {
    if (!jsonMode) printWarning('No previous epoch data found for this wallet.');
    return { wallet: walletAddress, status: 'no_epoch' };
  }

  if (previousEpoch.claimState === 'Yes') {
    if (!jsonMode) printInfo(`Already claimed for epoch starting ${previousEpoch.epochStartDate}.`);
    return {
      wallet:         walletAddress,
      status:         'already_claimed',
      epochStartDate: previousEpoch.epochStartDate,
      soulClaimed:    Number(previousEpoch.userSoul ?? 0),
    };
  }

  if (previousEpoch.claimState === 'Claiming') {
    if (!jsonMode) printWarning('A claim is already in progress for this epoch. Please wait a moment and check again.');
    return { wallet: walletAddress, status: 'in_progress', epochStartDate: previousEpoch.epochStartDate };
  }

  const soulAmount = Number(previousEpoch.userSoul ?? 0);
  if (!soulAmount || soulAmount <= 0) {
    if (!jsonMode) printInfo('No SOUL available to claim for the previous epoch.');
    return { wallet: walletAddress, status: 'no_soul', epochStartDate: previousEpoch.epochStartDate };
  }

  // ── Show summary (human mode only) ────────────────────────────────────────
  if (!jsonMode) printClaimSummary(walletAddress, previousEpoch);

  // ── Dry-run short-circuits here ───────────────────────────────────────────
  if (options.dryRun) {
    if (!jsonMode) printWarning('Dry-run mode — no claim was submitted.');
    return {
      wallet:         walletAddress,
      status:         'dry_run',
      epochStartDate: previousEpoch.epochStartDate,
      soulClaimed:    soulAmount,
    };
  }

  // ── Confirm (human mode only — JSON mode auto-confirms) ───────────────────
  if (!jsonMode) {
    let confirmAnswer;
    try {
      confirmAnswer = await inquirer.prompt([
        {
          type:    'confirm',
          name:    'confirm',
          message: `Claim ${soulAmount.toFixed(6)} SOUL for this wallet?`,
          default: false,
        },
      ]);
    } catch (err) {
      if (isExitPrompt(err)) { console.log('\nAborted.'); process.exit(0); }
      throw err;
    }

    if (!confirmAnswer.confirm) {
      printWarning('Claim cancelled by user.');
      return { wallet: walletAddress, status: 'aborted', epochStartDate: previousEpoch.epochStartDate };
    }
  }

  // ── Submit claim ──────────────────────────────────────────────────────────
  if (!jsonMode) printInfo('Submitting claim to Graveyard Protocol...');

  let result;
  try {
    result = await claimSoul(walletAddress, previousEpoch.epochStartDate);
  } catch (err) {
    return { wallet: walletAddress, status: 'error', error: `Claim failed: ${err.message}` };
  }

  if (!jsonMode) {
    printSuccess(`SOUL claimed successfully!`);
    console.log('');
    console.log(`  ${c('bold', 'SOUL claimed')} : ${c('green', soulAmount.toFixed(6))} SOUL`);
    console.log(`  ${c('bold', 'TX signature')} : ${c('dim', result.txSignature)}`);
    console.log('');
  }

  return {
    wallet:         walletAddress,
    status:         'claimed',
    epochStartDate: previousEpoch.epochStartDate,
    soulClaimed:    soulAmount,
    txSignature:    result.txSignature,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * Agent-compatible flags:
 *   --wallet <address>   claim for a specific wallet address
 *   --all                claim for all saved wallets in sequence
 *   --dry-run            preview claimable SOUL without submitting
 *   --json               machine-readable JSON output; auto-confirms, suppresses human text
 *
 * JSON output schema:
 *   {
 *     "success": true,
 *     "wallets": [
 *       { "wallet": "…", "status": "claimed", "soulClaimed": 1.234567,
 *         "txSignature": "…", "epochStartDate": 20260317 },
 *       { "wallet": "…", "status": "already_claimed", "soulClaimed": 0.5, "epochStartDate": 20260317 },
 *       { "wallet": "…", "status": "no_soul",         "epochStartDate": 20260317 },
 *       { "wallet": "…", "status": "error",           "error": "…" }
 *     ]
 *   }
 *   { "success": false, "error": "…" }
 *
 * status values: claimed | dry_run | already_claimed | in_progress | no_soul | no_epoch | aborted | error
 */
export default async function claimSoulCommand(options) {
  let inquirer;
  const jsonMode = Boolean(options.json);

  if (!jsonMode) {
    const mod = await import('inquirer');
    inquirer = mod.default;
  }

  try {
    const walletFile = loadWalletFile();

    // ── --all: iterate every saved wallet ────────────────────────────────
    if (options.all) {
      if (!walletFile.wallets.length) {
        throw new Error('No wallets saved. Run `gp add-wallet` first.');
      }

      if (!jsonMode) printInfo(`Checking ${walletFile.wallets.length} wallet(s) for claimable SOUL...\n`);

      const walletResults = [];
      let totalClaimed = 0;
      let claimedCount = 0;
      let skippedCount = 0;

      for (const w of walletFile.wallets) {
        const outcome = await claimForWallet(w.publicKey, options, jsonMode, inquirer);
        walletResults.push(outcome);

        if (outcome.status === 'claimed') {
          totalClaimed += outcome.soulClaimed ?? 0;
          claimedCount++;
        } else if (outcome.status === 'error') {
          if (!jsonMode) printError(`${w.publicKey.slice(0, 8)}…: ${outcome.error}`);
          skippedCount++;
        } else {
          skippedCount++;
        }
      }

      if (jsonMode) {
        jsonExit({ success: true, wallets: walletResults });
        return;
      }

      // Human summary
      printHeader('Claim Summary');
      console.log(`  Wallets with successful claims : ${c('green',  claimedCount)}`);
      console.log(`  Wallets skipped / no SOUL      : ${c('grey',   skippedCount)}`);
      if (!options.dryRun && claimedCount > 0) {
        console.log(`  Total SOUL claimed             : ${c('green', totalClaimed.toFixed(6))} SOUL`);
      }
      console.log('');
      return;
    }

    // ── Single wallet (prompt or --wallet flag) ───────────────────────────
    let walletAddress;

    if (options.wallet) {
      walletAddress = options.wallet;
    } else {
      if (jsonMode) {
        jsonExit({ success: false, error: 'JSON mode requires --wallet <address> or --all' }, 1);
        return;
      }
      walletAddress = await selectWallet(walletFile, inquirer);
    }

    const outcome = await claimForWallet(walletAddress, options, jsonMode, inquirer);

    if (jsonMode) {
      jsonExit({ success: true, wallets: [outcome] });
      return;
    }

  } catch (err) {
    if (jsonMode) jsonExit({ success: false, error: err.message }, 1);
    printError(err.message);
    process.exit(1);
  }
}
