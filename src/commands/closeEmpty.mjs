/**
 * @license
 * Graveyard Protocol CLI
 * Copyright (c) 2026 Graveyard Protocol. All rights reserved.
 * This software and its source code are proprietary.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import inquirer from 'inquirer';
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

// ── Main handler ──────────────────────────────────────────────────────────────
/**
 * Agent-compatible flags:
 *   --wallet <address>   target a specific saved wallet (skips interactive picker)
 *   --yes / -y           auto-confirm the "close accounts?" prompt
 *   --all                process every saved wallet in sequence
 *   --dry-run            simulate without submitting transactions
 *   --verbose            detailed sub-step output for each batch
 *
 * Encryption is handled transparently by loadWallet():
 *   • Unencrypted wallets (--no-pwd at add-wallet time) → no password prompt,
 *     fully non-interactive end-to-end when combined with --wallet --yes.
 *   • Encrypted wallets → password prompt appears as normal.
 *
 * Full agent one-liner (unencrypted wallet):
 *   gp close-empty --wallet <address> --yes
 *
 * Full agent one-liner (dry-run, all wallets):
 *   gp close-empty --all --dry-run --yes
 */
export default async function closeEmpty(options) {
  printBanner();

  try {
    const walletFile = loadWalletFile();
    let walletAddresses = [];

    if (options.all) {
      if (!walletFile.wallets.length) {
        throw new Error('No wallets saved. Run `gp add-wallet` first.');
      }
      walletAddresses = walletFile.wallets.map(w => w.publicKey);
      printInfo(`Processing all ${walletAddresses.length} wallet(s).\n`);

    } else if (options.wallet) {
      walletAddresses = [options.wallet];

    } else {
      const selected  = await selectWallet(walletFile);
      walletAddresses = [selected];
    }

    for (const walletAddress of walletAddresses) {
      await processWallet(walletAddress, options);
    }

  } catch (err) {
    printError(err.message);
    process.exit(1);
  }
}

// ── Process a single wallet ───────────────────────────────────────────────────

async function processWallet(walletAddress, options) {
  const verbose = Boolean(options.verbose);
  const dryRun  = Boolean(options.dryRun);
  const autoYes = Boolean(options.yes);

  printHeader(`Wallet: ${walletAddress}`);

  // ── Step 1: Scan ──────────────────────────────────────────────────────────
  const scanSpinner = createSpinner('Scanning for empty token accounts...');
  scanSpinner.start();

  let scanData;
  try {
    scanData = await scanWallet(walletAddress);
    scanSpinner.succeed('Scan complete.');
  } catch (err) {
    scanSpinner.fail('Scan failed.');
    throw err;
  }

  if (scanData.total_empty_accounts === 0) {
    printInfo('No empty token accounts found. Nothing to close.');
    return;
  }

  printScanSummary(scanData);

  // ── Step 2: Confirm ───────────────────────────────────────────────────────
  if (autoYes) {
    const action = dryRun ? 'Dry-run' : 'Closing';
    printInfo(`${action} ${scanData.total_empty_accounts} account(s) — auto-confirmed via --yes.`);
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
      printWarning('Aborted by user.');
      return;
    }
  }

  // ── Step 3: Unlock wallet ─────────────────────────────────────────────────
  // loadWallet() handles encrypted vs unencrypted transparently:
  //   encrypted: false → returns Keypair immediately, no prompt
  //   encrypted: true  → prompts for password
  let keypair;
  try {
    keypair = await loadWallet(walletAddress);
  } catch (err) {
    throw new Error(`Failed to unlock wallet: ${err.message}`);
  }

  // ── Step 4: Get batch count ───────────────────────────────────────────────
  const countSpinner = createSpinner('Fetching batch count...');
  countSpinner.start();

  let totalBatches;
  try {
    totalBatches = await getBatchCount(walletAddress);
    countSpinner.succeed(`${totalBatches} batch(es) to process.`);
  } catch (err) {
    countSpinner.fail('Failed to fetch batch count.');
    throw err;
  }

  if (totalBatches === 0) {
    printWarning('Scan cache expired. Please run the command again to rescan.');
    return;
  }

  // ── Step 5: Process each DDB batch ───────────────────────────────────────
  const allResults = [];

  for (let batchId = 1; batchId <= totalBatches; batchId++) {

    if (!verbose) {
      printProgress(`Processing batch ${batchId} of ${totalBatches}...`);
    } else {
      console.log('');
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
      throw err;
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
      throw err;
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
      throw err;
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

      if (!verbose) {
        printSuccess(`Batch ${batchId} of ${totalBatches} — dry-run complete.`);
      } else {
        printSuccess(`Batch ${batchId}: dry-run — ${dryResults.length} transaction(s) would be submitted.`);
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
        throw err;
      }

      allResults.push(...batchResults);

      if (!verbose) {
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

  // ── Step 6: Results ───────────────────────────────────────────────────────
  printHeader(dryRun ? 'Dry-run Results' : 'Results');
  if (verbose) {
    allResults.forEach((r, i) => printBatchResult(r, i));
  }
  printFinalSummary(allResults, dryRun);
}
