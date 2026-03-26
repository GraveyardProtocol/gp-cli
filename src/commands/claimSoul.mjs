/**
 * @license
 * Graveyard Protocol CLI
 * Copyright (c) 2026 Graveyard Protocol. All rights reserved.
 * This software and its source code are proprietary.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import inquirer from 'inquirer';
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
  console.log(`${fmt(d)} → ${fmt(end)}`);
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

async function claimForWallet(walletAddress, options) {
  printHeader(`Claim SOUL: ${walletAddress}`);
  printInfo('Fetching epoch data...');

  let epochData;
  try {
    epochData = await getEpochData(walletAddress);
  } catch (err) {
    throw new Error(`Failed to fetch epoch data: ${err.message}`);
  }

  const { previousEpoch } = epochData;

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!previousEpoch) {
    printWarning('No previous epoch data found for this wallet.');
    return { skipped: true };
  }

  if (previousEpoch.claimState === 'Yes') {
    printInfo(`Already claimed for epoch starting ${previousEpoch.epochStartDate}.`);
    return { skipped: true };
  }

  if (previousEpoch.claimState === 'Claiming') {
    printWarning('A claim is already in progress for this epoch. Please wait a moment and check again.');
    return { skipped: true };
  }

  const soulAmount = Number(previousEpoch.userSoul ?? 0);
  if (!soulAmount || soulAmount <= 0) {
    printInfo('No SOUL available to claim for the previous epoch.');
    return { skipped: true };
  }

  // ── Show summary ──────────────────────────────────────────────────────────
  printClaimSummary(walletAddress, previousEpoch);

  // ── Dry-run short-circuits here ───────────────────────────────────────────
  if (options.dryRun) {
    printWarning('Dry-run mode — no claim was submitted.');
    return { skipped: true, dryRun: true };
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  let confirmAnswer;
  try {
    confirmAnswer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
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
    return { skipped: true };
  }

  // ── Submit claim ──────────────────────────────────────────────────────────
  printInfo('Submitting claim to Graveyard Protocol...');

  let result;
  try {
    result = await claimSoul(walletAddress, previousEpoch.epochStartDate);
  } catch (err) {
    throw new Error(`Claim failed: ${err.message}`);
  }

  printSuccess(`SOUL claimed successfully!`);
  console.log('');
  console.log(`  ${c('bold', 'SOUL claimed')} : ${c('green', soulAmount.toFixed(6))} SOUL`);
  console.log(`  ${c('bold', 'TX signature')} : ${c('dim', result.txSignature)}`);
  console.log('');

  return { success: true, txSignature: result.txSignature, soulClaimed: soulAmount };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function claimSoulCommand(options) {
  printBanner();

  try {
    const walletFile = loadWalletFile();

    // ── --all: iterate every saved wallet ────────────────────────────────
    if (options.all) {
      if (!walletFile.wallets.length) {
        throw new Error('No wallets saved. Run `gp add-wallet` first.');
      }

      printInfo(`Checking ${walletFile.wallets.length} wallet(s) for claimable SOUL...\n`);

      let totalClaimed = 0;
      let claimedCount = 0;
      let skippedCount = 0;

      for (const w of walletFile.wallets) {
        try {
          const outcome = await claimForWallet(w.publicKey, options);
          if (outcome.success) {
            totalClaimed += outcome.soulClaimed ?? 0;
            claimedCount++;
          } else {
            skippedCount++;
          }
        } catch (err) {
          // Don't abort the whole run — log and continue
          printError(`${w.publicKey.slice(0, 8)}…: ${err.message}`);
          skippedCount++;
        }
      }

      // Summary across all wallets
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
      walletAddress = await selectWallet(walletFile);
    }

    await claimForWallet(walletAddress, options);

  } catch (err) {
    printError(err.message);
    process.exit(1);
  }
}
