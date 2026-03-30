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
  printStatsSummaryTable,
} from '../display.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isExitPrompt(err) {
  return err?.name === 'ExitPromptError';
}

const C = { reset: '\x1b[0m', green: '\x1b[32m', cyan: '\x1b[36m' };
const c = (color, text) => `${C[color]}${text}${C.reset}`;

/** Emit JSON to stdout and exit. */
function jsonExit(payload, code = 0) {
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exitCode = code;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function formatEpochDate(yyyymmdd) {
  const s = String(yyyymmdd);
  const year = parseInt(s.slice(0, 4), 10);
  const month = parseInt(s.slice(4, 6), 10) - 1;
  const day = parseInt(s.slice(6, 8), 10);
  return new Date(Date.UTC(year, month, day)).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

// ── CSV export ────────────────────────────────────────────────────────────────

function buildCsvRows(rows) {
  const header = [
    'Wallet Address', 'Description',
    'Lifetime Accounts Closed', 'Lifetime SOL Recovered', 'Lifetime SOUL Claimed',
    'Current Epoch Start', 'Current Epoch Accounts Closed', 'Current Epoch SOL Earned',
    'Current Epoch Ghost Points', 'Current Epoch Ghost Share',
    'Previous Epoch Start', 'Previous Epoch Accounts Closed', 'Previous Epoch SOL Earned',
    'Previous Epoch Ghost Points', 'Previous Epoch Ghost Share',
    'Previous Epoch SOUL Claimed', 'Previous Epoch Claim State',
  ];

  const dataRows = rows.map((row) => {
    const cur = row.currentEpoch;
    const prev = row.previousEpoch;
    const curGhost = Number(cur?.userGhostEarned ?? 0) + Number(cur?.userGhostReferrals ?? 0);
    const prevGhost = Number(prev?.userGhostEarned ?? 0) + Number(prev?.userGhostReferrals ?? 0);
    const curShare = cur?.totalGhostEarned > 0 ? ((curGhost / cur.totalGhostEarned) * 100).toFixed(2) : '0.00';
    const prevShare = prev?.totalGhostEarned > 0 ? ((prevGhost / prev.totalGhostEarned) * 100).toFixed(2) : '0.00';
    return [
      row.walletAddress, row.description || '',
      row.userStats?.totalAccountsClosed ?? 0,
      row.userStats?.totalSolsRecovered ?? 0,
      row.userStats?.totalSoulClaimed ?? 0,
      cur ? formatEpochDate(cur.epochStartDate) : '',
      cur ? cur.userAccountsClosed : 0,
      cur ? cur.userSolsRecovered.toFixed(6) : 0,
      cur ? curGhost : 0,
      cur ? curShare : 0,
      prev ? formatEpochDate(prev.epochStartDate) : '',
      prev ? prev.userAccountsClosed : 0,
      prev ? prev.userSolsRecovered.toFixed(6) : 0,
      prev ? prevGhost : 0,
      prev ? prevShare : 0,
      prev ? prev.userSoul.toFixed(6) : 0,
      prev ? prev.claimState : '',
    ];
  });

  const escape = (v) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...dataRows].map(r => r.map(escape).join(',')).join('\n');
}

/**
 * Writes CSV output.
 *
 *   csvOut   → write to that explicit path, no prompt
 *   autoYes  → write to default ~/gp-stats-…csv path, no prompt
 *   otherwise → interactive "Download CSV?" confirm prompt
 */
async function offerCsvDownload(label, rows, { autoYes = false, csvOut = null, inquirer = null } = {}) {

  if (!inquirer) return;
  if (csvOut) {
    fs.writeFileSync(csvOut, buildCsvRows(rows), 'utf8');
    console.log(`\n  ${c('green', '✔')} CSV saved to ${c('cyan', csvOut)}\n`);
    return;
  }

  if (autoYes) {
    const filename = `gp-stats-${label}-${new Date().toISOString().slice(0, 10)}.csv`;
    const dest = path.join(os.homedir(), filename);
    fs.writeFileSync(dest, buildCsvRows(rows), 'utf8');
    console.log(`\n  ${c('green', '✔')} CSV saved to ${c('cyan', dest)}\n`);
    return;
  }

  let answer;
  try {
    answer = await inquirer.prompt([
      { type: 'confirm', name: 'download', message: 'Download stats as CSV?', default: false },
    ]);
  } catch (err) {
    if (isExitPrompt(err)) { console.log('\nAborted.'); process.exit(0); }
    throw err;
  }
  if (!answer.download) return;

  const filename = `gp-stats-${label}-${new Date().toISOString().slice(0, 10)}.csv`;
  const dest = path.join(os.homedir(), filename);
  fs.writeFileSync(dest, buildCsvRows(rows), 'utf8');
  console.log(`\n  ${c('green', '✔')} CSV saved to ${c('cyan', dest)}\n`);
}

// ── Core fetch + display ──────────────────────────────────────────────────────

async function fetchWalletData(walletAddress) {
  let epochData = { currentEpoch: null, previousEpoch: null };
  let userStats = null;

  const [epochResult, userResult] = await Promise.allSettled([
    getEpochData(walletAddress),
    getUserStats(walletAddress),
  ]);

  if (epochResult.status === 'fulfilled') {
    epochData = epochResult.value;
  } else {
    // Suppress human-visible warning in JSON mode — callers handle null fields
    if (!globalThis.__gpJsonMode) {
      printWarning(`Epoch data unavailable: ${epochResult.reason?.message}`);
    }
  }

  if (userResult.status === 'fulfilled') {
    userStats = userResult.value;
  } else {
    if (!globalThis.__gpJsonMode) {
      printWarning(`Lifetime stats unavailable: ${userResult.reason?.message}`);
    }
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
  printEpochStatsBlock('Current Epoch', currentEpoch);
  printEpochStatsBlock('Previous Epoch', previousEpoch);
  console.log('');
  return data;
}

// ── Main handler ──────────────────────────────────────────────────────────────
/**
 * Agent-compatible flags:
 *   --wallet <address>   look up any wallet address (no saved wallet needed)
 *   --all                all saved wallets summary table
 *   --yes / -y           skip "Download CSV?" prompt, write to default path
 *   --csv-out <path>     write CSV to explicit path, no prompt
 *   --json               machine-readable JSON output; suppresses all human text
 *
 * JSON output schema:
 *   {
 *     "success": true,
 *     "wallets": [{
 *       "walletAddress": "…",
 *       "description": "…",
 *       "userStats": { "totalAccountsClosed": 0, "totalSolsRecovered": 0, "totalSoulClaimed": 0 },
 *       "currentEpoch": {
 *         "epochStartDate": 20260324,
 *         "userGhostEarned": 4200,
 *         "userGhostReferrals": 420,
 *         "userAccountsClosed": 42,
 *         "userSolsRecovered": 0.085764,
 *         "totalUsers": 1337,
 *         "totalGhostEarned": 9999999,
 *         "ghostSharePct": "0.0463"
 *       },
 *       "previousEpoch": { …same fields…, "userSoul": 1.234567, "claimState": "No" }
 *     }]
 *   }
 *   { "success": false, "error": "…" }
 */
export default async function stats(options) {
  const jsonMode = Boolean(options.json);

  if (jsonMode && (options.csvOut || options.yes)) {
    jsonExit({
      success: false,
      error: '--csv-out and --yes cannot be used with --json',
    }, 1);
    return;
  }

  let inquirer;
  if (!jsonMode) {
    const mod = await import('inquirer');
    inquirer = mod.default;
  }

  globalThis.__gpJsonMode = jsonMode;   // shared flag for fetchWalletData warnings

  const autoYes = Boolean(options.yes);
  const csvOut = options.csvOut || null;

  try {
    const walletFile = loadWalletFile();

    // ── --all mode ────────────────────────────────────────────────────────
    if (options.all) {
      if (!walletFile.wallets.length) {
        throw new Error('No wallets saved. Run `gp add-wallet` first.');
      }

      if (!jsonMode) printInfo(`Fetching stats for ${walletFile.wallets.length} wallet(s)...\n`);

      const rows = [];
      for (const w of walletFile.wallets) {
        const data = await fetchWalletData(w.publicKey);
        rows.push({ walletAddress: w.publicKey, name: w.name || '', ...data });
      }

      if (jsonMode) {
        jsonExit({ success: true, wallets: rows.map(normaliseRow) });
        return;
      }

      printStatsSummaryTable(rows);
      await offerCsvDownload('All', rows, { autoYes, csvOut, inquirer });
      return;
    }

    // ── Single wallet ─────────────────────────────────────────────────────
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

    let data;
    if (jsonMode) {
      data = await fetchWalletData(walletAddress);
    } else {
      data = await fetchAndPrintStats(walletAddress);
    }

    const walletEntry = walletFile.wallets.find(w => w.publicKey === walletAddress);

    if (jsonMode) {
      jsonExit({
        success: true,
        wallets: [normaliseRow({
          walletAddress,
          description: walletEntry?.description || '',
          ...data,
        })],
      });
      return;
    }

    const rows = [{ walletAddress, description: walletEntry?.description || '', ...data }];
    const fileLabel = walletAddress.slice(0, 4) + '…' + walletAddress.slice(-4);
    await offerCsvDownload(fileLabel, rows, { autoYes, csvOut, inquirer });
  } catch (err) {
    if (jsonMode) jsonExit({ success: false, error: err.message }, 1);
    printError(err.message);
    process.exit(1);
  }
}

// ── JSON normaliser — adds computed ghostSharePct fields ──────────────────────

function normaliseRow(row) {
  return {
    walletAddress: row.walletAddress,
    description: row.description || '',
    userStats: row.userStats ?? null,
    currentEpoch: normaliseEpoch(row.currentEpoch),
    previousEpoch: normaliseEpoch(row.previousEpoch),
  };
}

function normaliseEpoch(epoch) {
  if (!epoch) return null;
  const userGhost = Number(epoch.userGhostEarned ?? 0) + Number(epoch.userGhostReferrals ?? 0);
  const ghostSharePct = epoch.totalGhostEarned > 0
    ? ((userGhost / epoch.totalGhostEarned) * 100).toFixed(4)
    : '0.0000';
  return { ...epoch, userGhostTotal: userGhost, ghostSharePct };
}
