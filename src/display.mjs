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
  const totalBatches = Math.ceil(results.length/10);

  console.log('');
  console.log(c('bold', dryRun ? '  Dry-run Summary' : '  Summary'));
  console.log(c('grey',  '  ──────────────────────────────────────'));
  if (dryRun) {
    console.log(`  Total Batches : ${c('cyan',   totalBatches)}`);
    console.log(`  Total Transactions simulated : ${c('green',   succeeded.length)}`);
    console.log(`  Accounts closed : ${c('yellow', totalAcct)}`);
    console.log(`  SOL reclaimed (~80%) : ${c('green', totalSol.toFixed(6))} SOL`);
    console.log(c('yellow', '\n  ⚠  Dry-run — no transactions were submitted.'));
  } else {
    console.log(`  Total Batches : ${c('cyan',   totalBatches)}`);
    console.log(`  Transactions succeeded      : ${c('green',  succeeded.length)}`);
    if (failed.length) {
      console.log(`  Transactions failed         : ${c('red',    failed.length)}`);
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


// ── Lifetime user stats block renderer ───────────────────────────────────────

export function printUserStatsBlock(walletAddress, userStats) {
  const divider = c('grey', '  ──────────────────────────────────────');
  console.log('');
  console.log(c('bold', '  Lifetime Stats'));
  console.log(divider);

  if (!userStats) {
    console.log(c('grey', '  No lifetime stats available.'));
    return;
  }

  console.log(`  Total accounts closed : ${c('yellow', (userStats.totalAccountsClosed ?? 0).toLocaleString())}`);
  console.log(`  Total SOL recovered   : ${c('green',  ((userStats.totalSolsRecovered ?? 0)).toFixed(6))} SOL`);
  console.log(`  Total SOUL claimed    : ${c('cyan',   ((userStats.totalSoulClaimed   ?? 0)).toFixed(6))} SOUL`);
}

// ── Epoch block renderer ──────────────────────────────────────────────────────

export function printEpochStatsBlock(label, epoch) {
  const divider = c('grey', '  ──────────────────────────────────────');
  console.log('');
  console.log(c('bold', `  ${label}`));
  console.log(divider);

  if (!epoch) {
    console.log(c('grey', '  No data available for this epoch.'));
    return;
  }

  const dateRange = formatEpochRange(epoch.epochStartDate);
  const userGhost = (Number(epoch.userGhostEarned)+ Number(epoch.userGhostReferrals));

  // ── User section ─────────────────────────────────────────────────────────
  console.log(`  ${c('dim', 'Period')}                : ${c('white', dateRange)}`);
  console.log('');
  console.log(c('dim', '  Your activity'));
  console.log(`  Accounts closed      : ${c('yellow', epoch.userAccountsClosed.toLocaleString())}`);
  console.log(`  SOL earned           : ${c('green',  epoch.userSolsRecovered.toFixed(6))} SOL`);
  console.log(`  Ghost Points earned  : ${c('cyan',   userGhost.toLocaleString())}`);
    // ── User share ────────────────────────────────────────────────────────────
  if (epoch.totalGhostEarned > 0 && epoch.userGhostEarned > 0) {
    const share = ((userGhost / epoch.totalGhostEarned) * 100).toFixed(4);
    console.log(`  Your Ghost share     : ${c('cyan', share + '%')}`);
  }

  if (label === "Previous Epoch") {
    console.log(`  SOUL earned          : ${c('cyan', epoch.userSoul.toLocaleString())}`);
    const claimBadge = epoch.claimState === 'Yes'
      ? c('green', '✔ Claimed')
      : c('red', '✖ Not Claimed');
    console.log(`  Claim state          : ${claimBadge}`);
  }

  // ── Global section ────────────────────────────────────────────────────────
  console.log('');
  console.log(c('dim', '  Network-wide'));
  console.log(`  Participants         : ${c('white',  epoch.totalUsers.toLocaleString())}`);
  console.log(`  Total Ghost earned   : ${c('cyan',   epoch.totalGhostEarned.toLocaleString())}`);
  if (label === "Previous Epoch") {
    console.log(`  Total SOUL allocated : ${c('green', epoch.totalSoul?.toFixed ? epoch.totalSoul.toFixed(6) : '—')} SOUL`);
  }
}

// ── Statistics Summary table (--all mode) ────────────────────────────────────────────────
export function printStatsSummaryTable(rows) {
  // rows: [{ walletAddress, description, userStats, currentEpoch, previousEpoch }]
  const divider = c('grey', '─'.repeat(115));
  const hdr = (s) => c('bold', s);

  console.log('');
  console.log(c('bold', '  All-Wallet Summary'));
  console.log('  ' + divider);

  // Header
  console.log(
    '  ' +
    hdr(padR('Wallet',          14)) + '  ' +
    hdr(padR('Description',     16)) + '  ' +
    hdr(padL('Closed(life)',    14)) + '  ' +
    hdr(padL('SOL(life)',       10)) + '  ' +
    hdr(padL('SOUL(life)',      11)) + '  ' +
    hdr(padL('Closed(cur)',     12)) + '  ' +
    hdr(padL('SOL(cur)',        10)) + '  ' +
    hdr(padL('GHOST(cur)',      11))
  );

  console.log('  ' + divider);

  for (const row of rows) {
    const curUserGhost = (Number(row.currentEpoch?.userGhostEarned??0)+ Number(row.currentEpoch?.userGhostReferrals??0));

    const shortWallet = row.walletAddress.slice(0, 6) + '…' + row.walletAddress.slice(-6);
    const desc        = (row.description || '—').slice(0, 18);
    const closed      = (row.userStats?.totalAccountsClosed ?? 0).toLocaleString();
    const sol         = (row.userStats?.totalSolsRecovered  ?? 0).toFixed(4);
    const soul        = (row.userStats?.totalSoulClaimed    ?? 0).toFixed(4);
    const closedCur    = (row.currentEpoch?.userAccountsClosed  ?? 0).toLocaleString();
    const solCur   = (row.currentEpoch?.userSolsRecovered ?? 0).toFixed(4);
    const ghostCur   = curUserGhost.toLocaleString();

    console.log(
      '  ' +
      c('dim',    padR(shortWallet, 14)) + '  ' +
      c('white',  padR(desc,        16)) + '  ' +
      c('yellow', padL(closed,      14)) + '  ' +
      c('yellow',  padL(sol,        10)) + '  ' +
      c('yellow',   padL(soul,      11)) + '  ' +
      c('cyan',   padL(closedCur,   12)) + '  ' +
      c('cyan',   padL(solCur,      10)) + '  ' +
      c('cyan',   padL(ghostCur,    11))
    );
  }

  console.log('  ' + divider);

  // Totals row
  const totClosed = rows.reduce((s, r) => s + (r.userStats?.totalAccountsClosed ?? 0), 0);
  const totSol    = rows.reduce((s, r) => s + (r.userStats?.totalSolsRecovered  ?? 0), 0);
  const totSoul   = rows.reduce((s, r) => s + (r.userStats?.totalSoulClaimed    ?? 0), 0);
  const totClosedC = rows.reduce((s, r) => s + (r.currentEpoch?.totalAccountsClosed ?? 0), 0);
  const totSolC    = rows.reduce((s, r) => s + (r.currentEpoch?.totalSolsRecovered  ?? 0), 0);
  const totGhostC = rows.reduce((s, r) => s + (r.currentEpoch?.userGhostEarned  ?? 0 + r.currentEpoch?.userGhostReferrals  ?? 0), 0);

  console.log(
    '  ' +
    c('bold', padR('TOTAL', 18)) + '  ' +
    padR('', 12) + '  ' +
    c('green', padL(totClosed.toLocaleString(), 14)) + '  ' +
    c('green',  padL(totSol.toFixed(4),          10)) + '  ' +
    c('green',   padL(totSoul.toFixed(4),         11)) + '  ' +
    c('green', padL(totClosedC.toLocaleString(), 12)) + '  ' +
    c('green',  padL(totSolC.toFixed(4),          10)) + '  ' +
    c('green',   padL(totGhostC.toLocaleString(), 11))
  );

  console.log('  ' + divider);
  console.log('');
}

function padR(s, n) { return String(s).padEnd(n).slice(0, n); }
function padL(s, n) { return String(s).padStart(n).slice(-n); }

function formatEpochRange(yyyymmdd) {
  const s = String(yyyymmdd);
  const start = new Date(Date.UTC(
    parseInt(s.slice(0, 4), 10),
    parseInt(s.slice(4, 6), 10) - 1,
    parseInt(s.slice(6, 8), 10),
  ));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const fmt = (d) => d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  return `${fmt(start)} → ${fmt(end)}`;
}