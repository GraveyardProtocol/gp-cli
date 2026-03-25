/**
 * @license
 * Graveyard Protocol CLI
 * Copyright (c) 2026 Graveyard Protocol. All rights reserved.
 * This software and its source code are proprietary.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import { API_BASE_URL } from './config.mjs';

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function apiFetch(method, path, body) {
  const url = `${API_BASE_URL}${path}`;

  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new Error(`Network error calling ${url}: ${err.message}`);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Non-JSON response from ${url} (HTTP ${res.status})`);
  }

  if (!res.ok || json.success === false) {
    const msg = json.error || json.message || `HTTP ${res.status}`;
    throw new Error(`API error [${path}]: ${msg}`);
  }

  return json;
}

// ── 1. Scan Wallet ────────────────────────────────────────────────────────────
// GET /v2/wallet/scan/{walletAddress}
// Returns: { wallet, total_empty_accounts, total_rent_sol,
//            estimated_ghost_rewards, estimated_fees, scanTimestamp }

export async function scanWallet(walletAddress) {
  const res = await apiFetch('GET', `/v2/wallet/scan/${walletAddress}`);
  return res.data;
}

// ── 2. Get Batch Count ────────────────────────────────────────────────────────
// GET /v2/wallet/getBatchCount/{walletAddress}
// Returns: { wallet, totalBatches }

export async function getBatchCount(walletAddress) {
  const res = await apiFetch('GET', `/v2/wallet/getBatchCount/${walletAddress}`);
  return res.totalBatches;
}

// ── 3. Process / Build Batch ──────────────────────────────────────────────────
// POST /v2/wallet/processBatch
// Body:    { walletAddress, batchId }
// Returns: { batches: [{ intentID, instructionsBatch }] }

export async function processBatch(walletAddress, batchId) {
  const res = await apiFetch('POST', '/v2/wallet/processBatch', {
    walletAddress,
    batchId,
  });
  return res.data.batches;
}

// ── 4. Execute Batch ──────────────────────────────────────────────────────────
// POST /v2/wallet/executeBatch
// Body:    { walletAddress, transactions: [{ intentID, signedTransaction }] }
// Returns: { success, results: [{ intentID, txSignature, batchAccountsClosed,
//                                 batchRentSol, success, error? }] }

export async function executeBatch(walletAddress, transactions) {
  const res = await apiFetch('POST', '/v2/wallet/executeBatch', {
    walletAddress,
    transactions,
  });
  return res.results;
}

// ── 5. Get Latest Blockhash ───────────────────────────────────────────────────
// GET /api/solana/blockhash
// Returns: { blockhash, lastValidBlockHeight }

export async function getLatestBlockhash() {
  const res = await apiFetch('GET', '/api/solana/blockhash');
  return res.data; // { blockhash, lastValidBlockHeight }
}

// ── 6. Get User Epoch Data ────────────────────────────────────────────────────
// GET /api/wallet/epoch/data/{walletAddress}
// Returns: { currentEpoch, previousEpoch }
// Each epoch: { epochStartDate, userGhostEarned, userGhostReferrals,
//               userAccountsClosed, userSoul, claimState,
//               totalUsers, totalGhostEarned, totalSoul }

export async function getEpochData(walletAddress) {
  const res = await apiFetch('GET', `/api/wallet/epoch/data/${walletAddress}`);
  return res.data; // { currentEpoch, previousEpoch }
}


// ── 7. Get User Lifetime Stats ────────────────────────────────────────────────
// GET /api/stats/user/{walletAddress}
// Returns: { totalAccountsClosed, totalSolsRecovered, totalSoulClaimed }

export async function getUserStats(walletAddress) {
  const res = await apiFetch('GET', `/api/stats/user/${walletAddress}`);
  return res.data; // { totalAccountsClosed, totalSolsRecovered, totalSoulClaimed }
}