/**
 * @license
 * Graveyard Protocol CLI
 * Copyright (c) 2026 Graveyard Protocol. All rights reserved.
 * This software and its source code are proprietary. 
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

// Lightweight display helpers — no heavy dependencies.
// Uses ANSI escape codes directly so it works on every platform.

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  red:    '\x1b[31m',
  white:  '\x1b[37m',
  grey:   '\x1b[90m',
};

function c(color, text) {
  return `${C[color]}${text}${C.reset}`;
}

// ── Gradient banner ───────────────────────────────────────────────────────────
// Applies a per-character 24-bit RGB gradient across each banner line.
// Purple (128, 0, 255) → Green (0, 220, 100).
// Degrades gracefully on terminals without true-color support.

const GRADIENT_START = { r: 128, g: 0,   b: 255 };  // purple
const GRADIENT_END   = { r: 0,   g: 220, b: 100 };  // green

function trueColor(r, g, b, text) {
  return `\x1b[1m\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

function gradientLine(text) {
  // Count printable characters (skip leading spaces used for indent)
  const total = text.length || 1;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const t = i / (total - 1);
    const r = Math.round(GRADIENT_START.r + (GRADIENT_END.r - GRADIENT_START.r) * t);
    const g = Math.round(GRADIENT_START.g + (GRADIENT_END.g - GRADIENT_START.g) * t);
    const b = Math.round(GRADIENT_START.b + (GRADIENT_END.b - GRADIENT_START.b) * t);
    result += trueColor(r, g, b, text[i]);
  }
  return result;
}

export function printBanner() {
  const lines = [
    '  ░██████╗░██████╗ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░',
    '  ██╔════╝ ██╔══██╗            Graveyard Protocol CLI                 ',
    '  ██║░░██╗ ██████╔╝                    v1.0.0                         ',
    '  ██║░░╚═╝ ██╔═══╝                                                    ',
    '  ╚██████╗ ██║         Close empty SPL token accounts · Reclaim SOL   ',
    '   ╚═════╝ ╚═╝     ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░',
    '                                                                      '  
  ];
  console.log('');
  lines.forEach(line => console.log(gradientLine(line)));
}

// ── Section header ────────────────────────────────────────────────────────────
export function printHeader(text) {
  const line = '─'.repeat(50);
  console.log('');
  console.log(c('cyan', ` ${line}`));
  console.log(c('cyan', c('bold', `  ${text}`)));
  console.log(c('cyan', ` ${line}`));
}

// ── Scan summary ──────────────────────────────────────────────────────────────
export function printScanSummary(data) {
  const solNet = (data.total_rent_sol - data.estimated_fees).toFixed(6);
  console.log('');
  console.log(c('bold', '  Scan Results'));
  console.log(c('grey',  '  ──────────────────────────────────────'));
  console.log(`  Empty accounts found   : ${c('yellow', data.total_empty_accounts)}`);
  console.log(`  Total rent locked      : ${c('white',  data.total_rent_sol.toFixed(6))} SOL`);
  console.log(`  Protocol fee (20%)     : ${c('grey',   data.estimated_fees.toFixed(6))} SOL`);
  console.log(`  ${c('bold', 'You will receive')}       : ${c('green', solNet)} SOL`);
  console.log(`  Ghost Points earned    : ${c('cyan',   data.estimated_ghost_rewards.toLocaleString())}`);
  console.log('');
}

// ── Dry-run notice ────────────────────────────────────────────────────────────
export function printDryRunNotice() {
  console.log(c('yellow', '  ⚠  Dry-run mode — no transactions were submitted.\n'));
}

// ── Progress line ─────────────────────────────────────────────────────────────
export function printProgress(text) {
  process.stdout.write(`  ${c('grey', '→')} ${text}\n`);
}

// ── Spinner (simple write/clear on same line) ─────────────────────────────────
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ERASE_LINE = '\x1b[2K'; // ANSI: erase entire current line

export function createSpinner(text) {
  let i = 0;
  let timer;
  const isTTY = process.stdout.isTTY;

  return {
    start() {
      if (!isTTY) { process.stdout.write(`  ${text}...\n`); return; }
      timer = setInterval(() => {
        process.stdout.write(`\r${ERASE_LINE}  ${c('cyan', SPINNER_FRAMES[i++ % SPINNER_FRAMES.length])} ${text}`);
      }, 80);
    },
    succeed(msg) {
      clearInterval(timer);
      if (isTTY) process.stdout.write(`\r${ERASE_LINE}  ${c('green', '✔')} ${msg || text}\n`);
      else process.stdout.write(`  ✔ ${msg || text}\n`);
    },
    fail(msg) {
      clearInterval(timer);
      if (isTTY) process.stdout.write(`\r${ERASE_LINE}  ${c('red', '✖')} ${msg || text}\n`);
      else process.stdout.write(`  ✖ ${msg || text}\n`);
    },
  };
}

// ── Per-batch result row ──────────────────────────────────────────────────────
export function printBatchResult(result, index) {
  if (result.success) {
    console.log(
      `  ${c('green', '✔')} Batch ${index + 1}` +
      `  ${c('yellow', result.batchAccountsClosed)} accounts closed` +
      `  ${c('green', result.batchRentSol?.toFixed(6))} SOL reclaimed`
    );
    console.log(`    ${c('grey', 'tx:')} ${c('dim', result.txSignature)}`);
  } else {
    console.log(
      `  ${c('red', '✖')} Batch ${index + 1}  ${c('red', result.error || 'Unknown error')}`
    );
  }
}

// ── Final summary ─────────────────────────────────────────────────────────────
export function printFinalSummary(results, dryRun = false) {
  const succeeded  = results.filter(r => r.success);
  const failed     = results.filter(r => !r.success);
  const totalAcct  = succeeded.reduce((s, r) => s + (r.batchAccountsClosed || 0), 0);
  const totalSol   = succeeded.reduce((s, r) => s + (r.batchRentSol || 0), 0);

  console.log('');
  console.log(c('bold', dryRun ? '  Dry-run Summary' : '  Summary'));
  console.log(c('grey',  '  ──────────────────────────────────────'));
  if (dryRun) {
    console.log(`  Batches simulated      : ${c('cyan',   succeeded.length)}`);
    console.log(`  Accounts that would close : ${c('yellow', totalAcct)}`);
    console.log(`  SOL that would be reclaimed (~80%) : ${c('green', totalSol.toFixed(6))} SOL`);
    console.log(c('yellow', '\n  ⚠  Dry-run — no transactions were submitted.'));
  } else {
    console.log(`  Batches succeeded      : ${c('green',  succeeded.length)}`);
    if (failed.length) {
      console.log(`  Batches failed         : ${c('red',    failed.length)}`);
    }
    console.log(`  Accounts closed        : ${c('yellow', totalAcct)}`);
    console.log(`  SOL reclaimed (~80%)   : ${c('green',  totalSol.toFixed(6))} SOL`);
  }
  console.log('');
}

// ── Error ─────────────────────────────────────────────────────────────────────
export function printError(msg) {
  console.error(`\n  ${c('red', '✖')} ${c('bold', 'Error:')} ${msg}\n`);
}

// ── Info ──────────────────────────────────────────────────────────────────────
export function printInfo(msg) {
  console.log(`  ${c('cyan', 'ℹ')} ${msg}`);
}

export function printSuccess(msg) {
  console.log(`  ${c('green', '✔')} ${msg}`);
}

export function printWarning(msg) {
  console.log(`  ${c('yellow', '⚠')} ${msg}`);
}
