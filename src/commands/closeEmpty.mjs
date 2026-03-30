/**
 * @license
 * Graveyard Protocol CLI
 * Copyright (c) 2026 Graveyard Protocol. All rights reserved.
 * This software and its source code are proprietary.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import { loadWallet, loadWalletFile, selectWallet } from '../walletManager.mjs';
import { scanWallet, getBatchCount, processBatch, executeBatch, getLatestBlockhash } from '../api.mjs';
import { buildAndSignAll } from '../solana.mjs';
import {
  printBanner,
  printHeader,
  printScanSummary,
  printProgress,
  createSpinner,
  printBatchResult,
  printFinalSummary,
  printError,
  printInfo,
  printWarning,
  printSuccess,
} from '../display.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isExitPrompt(err) {
  return err?.name === 'ExitPromptError';
}

function maybeSpinner(verbose, text) {
  if (verbose) return createSpinner(text);
  return { start: () => {}, succeed: () => {}, fail: () => {} };
}

/** Emit a single JSON result line to stdout and exit with the given code. */
function jsonExit(payload, code = 0) {
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exitCode=code;
}

// ── Main handler ──────────────────────────────────────────────────────────────
/**
 * Agent-compatible flags:
 *   --wallet <address>   target a specific saved wallet (skips interactive picker)
 *   --yes / -y           auto-confirm the "close accounts?" prompt
 *   --all                process every saved wallet in sequence
 *   --dry-run            simulate without submitting transactions
 *   --verbose            detailed sub-step output for each batch
 *   --json               machine-readable JSON output; suppresses all human text
 *
 * JSON output (one object emitted per wallet, then process exits 0):
 *   {
 *     "success": true,
 *     "wallet": "…",
 *     "dryRun": false,
 *     "totalBatches": 3,
 *     "transactionsSucceeded": 3,
 *     "transactionsFailed": 0,
 *     "accountsClosed": 42,
 *     "solReclaimed": 0.085764,
 *     "results": [{ "intentID": "…", "txSignature": "…",
 *                   "batchAccountsClosed": 14, "batchRentSol": 0.028, "success": true }]
 *   }
 *   On error:
 *   { "success": false, "wallet": "…", "error": "…" }
 *
 * With --all, one JSON object per wallet is emitted (newline-delimited JSON).
 */
export default async function closeEmpty(options) {
  let inquirer;
  const jsonMode = Boolean(options.json);

  if (!jsonMode) {
    const mod = await import('inquirer');
    inquirer = mod.default;
  }

  try {
    const walletFile = loadWalletFile();
    let walletAddresses = [];

    if (options.all) {
      if (!walletFile.wallets.length) {
        throw new Error('No wallets saved. Run `gp add-wallet` first.');
      }
      walletAddresses = walletFile.wallets.map(w => w.publicKey);
      if (!jsonMode) printInfo(`Processing all ${walletAddresses.length} wallet(s).\n`);

    } else if (options.wallet) {
      walletAddresses = [options.wallet];

    } else {
      if (jsonMode) {
        // In JSON mode without --wallet or --all, we cannot prompt — error out.
        jsonExit({ success: false, error: 'JSON mode requires --wallet <address> or --all' }, 1);
        return;
      }
      const selected  = await selectWallet(walletFile);
      walletAddresses = [selected];
    }

    const allWalletResults = [];

    for (const walletAddress of walletAddresses) {
      const result = await processWallet(walletAddress, options, jsonMode);
      allWalletResults.push(result);

      if (jsonMode) {
        // Emit each wallet result as it completes (streaming NDJSON)
        process.stdout.write(JSON.stringify(result) + '\n');
      }
    }

    if (jsonMode) return;

  } catch (err) {
    if (jsonMode) {
      jsonExit({ success: false, error: err.message }, 1);
      return;
    }
    printError(err.message);
    process.exit(1);
  }
}

// ── Process a single wallet ───────────────────────────────────────────────────

async function processWallet(walletAddress, options, jsonMode = false) {
  const verbose = Boolean(options.verbose) && !jsonMode;
  const dryRun  = Boolean(options.dryRun);
  const autoYes = Boolean(options.yes);

  if (!jsonMode) printHeader(`Wallet: ${walletAddress}`);

  // ── Step 1: Scan ──────────────────────────────────────────────────────────
  let scanSpinner;
  if (!jsonMode) {
    scanSpinner = createSpinner('Scanning for empty token accounts...');
    scanSpinner.start();
  }

  let scanData;
  try {
    scanData = await scanWallet(walletAddress);
    if (!jsonMode) scanSpinner.succeed('Scan complete.');
  } catch (err) {
    if (!jsonMode) scanSpinner.fail('Scan failed.');
    return { success: false, wallet: walletAddress, error: err.message };
  }

  if (scanData.total_empty_accounts === 0) {
    if (!jsonMode) printInfo('No empty token accounts found. Nothing to close.');
    return {
      success: true,
      wallet: walletAddress,
      dryRun,
      totalBatches: 0,
      transactionsSucceeded: 0,
      transactionsFailed: 0,
      accountsClosed: 0,
      solReclaimed: 0,
      results: [],
    };
  }

  if (!jsonMode) printScanSummary(scanData);

  // ── Step 2: Confirm ───────────────────────────────────────────────────────
  if (autoYes || jsonMode) {
    if (!jsonMode) {
      const action = dryRun ? 'Dry-run' : 'Closing';
      printInfo(`${action} ${scanData.total_empty_accounts} account(s) — auto-confirmed.`);
    }
  } else {
    const confirmMsg = dryRun
      ? `Run dry-run for ${scanData.total_empty_accounts} account(s)?`
      : `Close ${scanData.total_empty_accounts} account(s) and reclaim SOL?`;

    let confirmAnswer;
    try {
      confirmAnswer = await inquirer.prompt([
        { type: 'confirm', name: 'confirm', message: confirmMsg, default: false },
      ]);
    } catch (err) {
      if (isExitPrompt(err)) { console.log('\nAborted.'); process.exit(0); }
      throw err;
    }

    if (!confirmAnswer.confirm) {
      if (!jsonMode) printWarning('Aborted by user.');
      return {
        success: true,
        wallet: walletAddress,
        status: 'aborted',
        dryRun,
        totalBatches: 0,
        transactionsSucceeded: 0,
        transactionsFailed: 0,
        accountsClosed: 0,
        solReclaimed: 0,
        results: [],
      };
    }
  }

  // ── Step 3: Unlock wallet ─────────────────────────────────────────────────
  let keypair;
  try {
    keypair = await loadWallet(walletAddress);
  } catch (err) {
    return { success: false, wallet: walletAddress, error: `Failed to unlock wallet: ${err.message}` };
  }

  // ── Step 4: Get batch count ───────────────────────────────────────────────
  let countSpinner;
  if (!jsonMode) {
    countSpinner = createSpinner('Fetching batch count...');
    countSpinner.start();
  }

  let totalBatches;
  try {
    totalBatches = await getBatchCount(walletAddress);
    if (!jsonMode) countSpinner.succeed(`${totalBatches} batch(es) to process.`);
  } catch (err) {
    if (!jsonMode) countSpinner.fail('Failed to fetch batch count.');
    return { success: false, wallet: walletAddress, error: err.message };
  }

  if (totalBatches === 0) {
    if (!jsonMode) printWarning('Scan cache expired. Please run the command again to rescan.');
    return { success: false, wallet: walletAddress, error: 'Scan cache expired — please rescan.' };
  }

  // ── Step 5: Process each DDB batch ───────────────────────────────────────
  const allResults = [];

  for (let batchId = 1; batchId <= totalBatches; batchId++) {

    if (!jsonMode) {
      printProgress(`Processing batch ${batchId} of ${totalBatches}...`);
    }

    // 5a. Fetch sub-batch instructions
    const buildSpinner = maybeSpinner(verbose, `Fetching instructions (batch ${batchId})...`);
    buildSpinner.start();

    let subBatches;
    try {
      subBatches = await processBatch(walletAddress, batchId);
      buildSpinner.succeed(`${subBatches.length} transaction(s) built.`);
    } catch (err) {
      buildSpinner.fail(`Failed to build batch ${batchId}.`);
      return { success: false, wallet: walletAddress, error: err.message };
    }

    // 5b. Fetch ONE blockhash per DDB batch
    const hashSpinner = maybeSpinner(verbose, 'Fetching latest blockhash...');
    hashSpinner.start();

    let blockhash;
    try {
      ({ blockhash } = await getLatestBlockhash());
      hashSpinner.succeed('Blockhash ready.');
    } catch (err) {
      hashSpinner.fail('Failed to fetch blockhash.');
      return { success: false, wallet: walletAddress, error: err.message };
    }

    // 5c. Build + sign all sub-batches at once
    const signSpinner = maybeSpinner(verbose, `Signing ${subBatches.length} transaction(s)...`);
    signSpinner.start();

    let signedTransactions;
    try {
      signedTransactions = buildAndSignAll(subBatches, blockhash, keypair);
      signSpinner.succeed(`Signed ${signedTransactions.length} transaction(s).`);
    } catch (err) {
      signSpinner.fail('Signing failed.');
      return { success: false, wallet: walletAddress, error: err.message };
    }

    // 5d. Execute or dry-run
    if (dryRun) {
      const dryResults = subBatches.map(sub => ({
        intentID:            sub.intentID,
        txSignature:         '(dry-run)',
        batchAccountsClosed: sub.batchAccountsClosed ?? 0,
        batchRentSol:        sub.batchRentSol        ?? 0,
        success:             true,
      }));
      allResults.push(...dryResults);

      if (!jsonMode) {
        if (!verbose) {
          printSuccess(`Batch ${batchId} of ${totalBatches} — dry-run complete.`);
        } else {
          printSuccess(`Batch ${batchId}: dry-run — ${dryResults.length} transaction(s) would be submitted.`);
        }
      }

    } else {
      const execSpinner = maybeSpinner(verbose, 'Submitting to Solana...');
      execSpinner.start();

      let batchResults;
      try {
        batchResults = await executeBatch(walletAddress, signedTransactions);
        const ok = batchResults.filter(r => r.success).length;
        execSpinner.succeed(`Executed — ${ok}/${batchResults.length} succeeded.`);
      } catch (err) {
        execSpinner.fail('Execution failed.');
        return { success: false, wallet: walletAddress, error: err.message };
      }

      allResults.push(...batchResults);

      if (!jsonMode && !verbose) {
        const ok     = batchResults.filter(r => r.success).length;
        const failed = batchResults.length - ok;
        if (failed === 0) {
          printSuccess(`Batch ${batchId} of ${totalBatches} processed successfully.`);
        } else {
          printWarning(`Batch ${batchId} of ${totalBatches} — ${ok} succeeded, ${failed} failed.`);
        }
      }
    }
  }

  // ── Step 6: Human results display ────────────────────────────────────────
  if (!jsonMode) {
    printHeader(dryRun ? 'Dry-run Results' : 'Results');
    if (verbose) {
      allResults.forEach((r, i) => printBatchResult(r, i));
    }
    printFinalSummary(allResults, dryRun);
  }

  // ── Step 7: Build structured return value ─────────────────────────────────
  const succeeded = allResults.filter(r => r.success);
  const failed    = allResults.filter(r => !r.success);

  return {
    success:                    true,
    wallet:                walletAddress,
    dryRun,
    totalBatches,
    transactionsSucceeded: succeeded.length,
    transactionsFailed:    failed.length,
    accountsClosed:        succeeded.reduce((s, r) => s + (r.batchAccountsClosed || 0), 0),
    solReclaimed:          succeeded.reduce((s, r) => s + (r.batchRentSol        || 0), 0),
    results:               allResults,
  };
}
