#!/usr/bin/env node

/**
 * @license
 * Graveyard Protocol CLI
 * Copyright (c) 2026 Graveyard Protocol. All rights reserved.
 * This software and its source code are proprietary.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import { Command } from 'commander';
import addWallet    from '../src/commands/addWallet.mjs';
import removeWallet from '../src/commands/removeWallet.mjs';
import listWallets  from '../src/commands/listWallets.mjs';
import closeEmpty   from '../src/commands/closeEmpty.mjs';
import stats        from '../src/commands/stats.mjs';
import claimSoul    from '../src/commands/claimSoul.mjs';
import { printBanner } from '../src/display.mjs';

const program = new Command();

program
  .name('gp')
  .version('1.1.0')
  .usage('[command] [options]')
  .description('Graveyard Protocol CLI — close empty SPL token accounts and reclaim SOL')
  .addHelpText('after', `
Agent / CI usage:
  Add wallets with --no-pwd so no password is ever required at runtime.
  Use --wallet, --yes, --csv-out and other flags below to run fully unattended.

  Example pipeline:
    $ gp add-wallet --keypair-file ~/.config/solana/id.json --no-pwd
    $ gp close-empty --wallet <address> --yes
  `);

// ── Wallet management ─────────────────────────────────────────────────────────

program
  .command('add-wallet')
  .description('Add a Solana wallet to local storage')
  .option('--keypair-file <path>', 'Path to a Solana keypair JSON file')
  .option('--private-key <value>', 'Inline private key (Base58 or JSON byte-array)')
  .option('--no-pwd',          'Store private key without encryption (agent / CI mode)')
  .option('--name <desc>',     'Wallet label — skips interactive prompt')
  .addHelpText('after', `
Key input (pick one):
  --keypair-file <path>    path to a Solana keypair JSON file (id.json)
  --private-key  <value>   inline Base58 string or JSON byte-array
  (neither flag)           interactive password-masked prompt

Encryption:
  default          prompts for password → key stored encrypted (🔒)
  --no-pwd         key stored in plaintext — no password ever  (🔓)
  `)
  .action((options) => addWallet(options));

program
  .command('remove-wallet')
  .description('Remove a saved wallet from local storage')
  .option('--wallet <address>', 'Public key of the wallet to remove')
  .action((options) => removeWallet(options));

program
  .command('list-wallets')
  .description('List all saved wallet public keys and status (🔒/🔓)')
  .action(listWallets);

// ── Core command ──────────────────────────────────────────────────────────────

program
  .command('close-empty')
  .description('Scan and close empty token accounts, reclaiming locked SOL')
  .option('--wallet <address>', 'Target wallet address')
  .option('--all',              'Process all saved wallets in sequence')
  .option('-y, --yes',          'Auto-confirm the "close accounts?" prompt')
  .option('--send-to <address>', 'Send reclaimed SOL to this address (future)')
  .option('--dry-run',          'Full pipeline but skip execution')
  .option('--verbose',          'Show detailed sub-step output')
  .addHelpText('after', `
Encryption Handling:
  🔓 unencrypted wallets → no password prompt → fully non-interactive
  🔒 encrypted wallets   → password prompt appears as normal
  `)
  .action(closeEmpty);

// ── Stats command ─────────────────────────────────────────────────────────────

program
  .command('stats')
  .description('Show Ghost Point and SOL earnings for the current and previous epoch')
  .option('--wallet <address>', 'Look up any wallet address')
  .option('--all',              'Show stats for all saved wallets')
  .option('-y, --yes',          'Auto-write CSV to default path')
  .option('--csv-out <path>',   'Write CSV to this explicit file path')
  .action(stats);

// ── Claim SOUL command ────────────────────────────────────────────────────────
program
  .command('claim-soul')
  .description('Claim SOUL tokens earned in the previous epoch')
  .option('--all',              'Claim for all saved wallets')
  .option('--wallet <address>', 'Claim for a specific wallet address')
  .option('--dry-run',          'Preview claimable SOUL without submitting')
  .action(claimSoul);

// ── Execution ────────────────────────────────────────────────────────────────

if (process.argv.length === 2) {
  printBanner();
  program.outputHelp();
} else {
  program.parse(process.argv);
}