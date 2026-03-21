#!/usr/bin/env node
import { Command } from 'commander';
import addWallet    from '../src/commands/addWallet.mjs';
import removeWallet from '../src/commands/removeWallet.mjs';
import listWallets from '../src/commands/listWallets.mjs';
import closeEmpty   from '../src/commands/closeEmpty.mjs';
import { printBanner } from '../src/display.mjs';

const program = new Command();

program
  .name('gp')
  .description('Graveyard Protocol CLI — close empty SPL token accounts and reclaim SOL')
  .version('1.0.0');

// ── Wallet commands ───────────────────────────────────────────────────────────
program
  .command('add-wallet')
  .description('Add a Solana wallet to local encrypted storage')
  .action(addWallet);

program
  .command('remove-wallet')
  .description('Remove a saved wallet from local storage')
  .action(removeWallet);

program
  .command('list-wallets')
  .description('List all saved wallet public keys')
  .action(listWallets);

// ── Core command ──────────────────────────────────────────────────────────────
program
  .command('close-empty')
  .description('Scan and close empty token accounts, reclaiming locked SOL')
  .option('--all',               'Process all saved wallets in sequence')
  .option('--send-to <address>', 'Send reclaimed SOL to this address (future)')
  .option('--dry-run',           'Run full pipeline but skip execution — show simulated results')
  .option('--verbose',           'Show detailed sub-step output for each batch')
  .action(closeEmpty);

// ── Print banner before help when no arguments are provided ───────────────────
if (process.argv.length === 2) {
  printBanner();
}

program.parse(process.argv);
