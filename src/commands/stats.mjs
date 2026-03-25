/**
 * @license
 * Graveyard Protocol CLI
 * Copyright (c) 2026 Graveyard Protocol. All rights reserved.
 * This software and its source code are proprietary.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import inquirer from 'inquirer';
import { loadWalletFile, selectWallet } from '../walletManager.mjs';
import { getEpochData, getUserStats } from '../api.mjs';
import {
  printBanner,
  printHeader,
  printError,
  printInfo,
  printWarning,
  printEpochStatsBlock,
  printUserStatsBlock,
  printStatsSummaryTable
} from '../display.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isExitPrompt(err) {
  return err?.name === 'ExitPromptError';
}

// ANSI helpers (mirrors display.mjs)
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

// ── Date helpers ──────────────────────────────────────────────────────────────

function formatEpochDate(yyyymmdd) {
  const s = String(yyyymmdd);
  const year  = parseInt(s.slice(0, 4), 10);
  const month = parseInt(s.slice(4, 6), 10) - 1;
  const day   = parseInt(s.slice(6, 8), 10);
  const d = new Date(Date.UTC(year, month, day));
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

// ── CSV export ────────────────────────────────────────────────────────────────

function buildCsvRows(rows) {
  const header = [
    'Wallet Address',
    'Description',
    'Lifetime Accounts Closed',
    'Lifetime SOL Recovered',
    'Lifetime SOUL Claimed',
    'Current Epoch Start',
    'Current Epoch Accounts Closed',
    'Current Epoch SOL Earned',
    'Current Epoch Ghost Points',
    'Current Epoch Ghost Share',
    'Previous Epoch Start',
    'Previous Epoch Accounts Closed',
    'Previous Epoch SOL Earned',
    'Previous Epoch Ghost Points',
    'Previous Epoch Ghost Share',
    'Previous Epoch SOUL Claimed',
    'Previous Epoch Claim State',
  ];

  const dataRows = rows.map((row) => {
    const cur  = row.currentEpoch;
    const prev = row.previousEpoch;
    const curUserGhost = (Number(cur.userGhostEarned)+ Number(cur.userGhostReferrals));
    const curGhostShare = ((curUserGhost / cur.totalGhostEarned) * 100).toFixed(2);
    const prevUserGhost = (Number(prev.userGhostEarned)+ Number(prev.userGhostReferrals));
    const prevGhostShare = ((prevUserGhost / prev.totalGhostEarned) * 100).toFixed(2);

    return [
      row.walletAddress,
      row.description || '',
      row.userStats?.totalAccountsClosed ?? 0,
      row.userStats?.totalSolsRecovered  ?? 0,
      row.userStats?.totalSoulClaimed    ?? 0,
      cur  ? formatEpochDate(cur.epochStartDate)  : '',
      cur  ? cur.userAccountsClosed  : 0,
      cur  ? cur.userSolsRecovered.toFixed(6)  : 0,
      cur  ? curUserGhost : 0,
      cur  ? curGhostShare : 0,
      prev ? formatEpochDate(prev.epochStartDate) : '',
      prev ? prev.userAccountsClosed : 0,
      prev ? prev.userSolsRecovered.toFixed(6) : 0,
      cur  ? prevUserGhost : 0,
      cur  ? prevGhostShare : 0,
      prev ? prev.userSoul.toFixed(6) : 0,
      prev ? prev.claimState          : '',
    ];
  });

  const escape = (v) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  return [header, ...dataRows].map((r) => r.map(escape).join(',')).join('\n');
}

async function offerCsvDownload(label, rows) {
  let answer;
  try {
    answer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'download',
        message: 'Download stats as CSV?',
        default: false,
      },
    ]);
  } catch (err) {
    if (isExitPrompt(err)) { console.log('\nAborted.'); process.exit(0); }
    throw err;
  }

  if (!answer.download) return;

  const csv      = buildCsvRows(rows);
  const filename = `gp-stats-${label}-${new Date().toISOString().slice(0, 10)}.csv`;
  const dest     = path.join(os.homedir(), filename);

  fs.writeFileSync(dest, csv, 'utf8');
  console.log(`\n  ${c('green', '✔')} CSV saved to ${c('cyan', dest)}\n`);
}

// ── Core fetch + display (single wallet) ─────────────────────────────────────

async function fetchWalletData(walletAddress) {
  let epochData = { currentEpoch: null, previousEpoch: null };
  let userStats = null;

  // Fetch epoch data and user lifetime stats in parallel
  const [epochResult, userResult] = await Promise.allSettled([
    getEpochData(walletAddress),
    getUserStats(walletAddress),
  ]);

  if (epochResult.status === 'fulfilled') {
    epochData = epochResult.value;
  } else {
    printWarning(`Epoch data unavailable: ${epochResult.reason?.message}`);
  }

  if (userResult.status === 'fulfilled') {
    userStats = userResult.value;
  } else {
    printWarning(`Lifetime stats unavailable: ${userResult.reason?.message}`);
  }

  return { userStats, ...epochData };
}

async function fetchAndPrintStats(walletAddress) {
  printHeader(`Stats: ${walletAddress}`);
  printInfo('Fetching stats...');

  const data = await fetchWalletData(walletAddress);
  const { userStats, currentEpoch, previousEpoch } = data;

  if (!userStats && !currentEpoch && !previousEpoch) {
    printWarning('No stats found for this wallet.');
    return data;
  }

  printUserStatsBlock(walletAddress, userStats);
  printEpochStatsBlock('Current Epoch',  currentEpoch);
  printEpochStatsBlock('Previous Epoch', previousEpoch);

  console.log('');
  return data;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function stats(options) {
  printBanner();

  try {
    const walletFile = loadWalletFile();

    // ── --all: summary table across every saved wallet ────────────────────
    if (options.all) {
      if (!walletFile.wallets.length) {
        throw new Error('No wallets saved. Run `gp add-wallet` first.');
      }

      printInfo(`Fetching stats for ${walletFile.wallets.length} wallet(s)...\n`);

      const rows = [];
      for (const w of walletFile.wallets) {
        // DON'T PRINT INDIVIDUAL WALLET DATA AS THERE MAY BE 100S OF WALLETS
        // printHeader(`Stats: ${w.publicKey}`);
        // printInfo('Fetching...');
        const data = await fetchWalletData(w.publicKey);
        rows.push({
          walletAddress: w.publicKey,
          description:   w.description || '',
          ...data,
        });
        // DON'T PRINT INDIVIDUAL WALLET DATA AS THERE MAY BE 100S OF WALLETS
        // printUserStatsBlock(w.publicKey, data.userStats);
        // printEpochStatsBlock('Current Epoch',  data.currentEpoch);
        // printEpochStatsBlock('Previous Epoch', data.previousEpoch);
        // console.log('');
      }

      printStatsSummaryTable(rows);
      await offerCsvDownload('All',rows);
      return;
    }

    // ── Single wallet (prompt or --wallet flag) ───────────────────────────
    let walletAddress;

    if (options.wallet) {
      walletAddress = options.wallet;
    } else {
      walletAddress = await selectWallet(walletFile);
    }

    const data = await fetchAndPrintStats(walletAddress);

    const walletEntry = walletFile.wallets.find((w) => w.publicKey === walletAddress);
    const rows = [{
      walletAddress,
      description: walletEntry?.description || '',
      ...data,
    }];
    const fileLable = walletAddress.slice(0, 4) + '…' + walletAddress.slice(-4);
    await offerCsvDownload(fileLable,rows);

  } catch (err) {
    printError(err.message);
    process.exit(1);
  }
}
