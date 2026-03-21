/**
 * @license
 * Graveyard Protocol CLI
 * Copyright (c) 2026 Graveyard Protocol. All rights reserved.
 * This software and its source code are proprietary. 
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

// ── Instruction deserialisation ───────────────────────────────────────────────
function deserialiseInstruction(raw) {
  const programId = new PublicKey(
    typeof raw.programId === 'string' ? raw.programId : raw.programId.toString()
  );

  const keys = (raw.keys || []).map((k) => ({
    pubkey:     new PublicKey(typeof k.pubkey === 'string' ? k.pubkey : k.pubkey.toString()),
    isSigner:   Boolean(k.isSigner),
    isWritable: Boolean(k.isWritable),
  }));

  let data;
  if (Buffer.isBuffer(raw.data)) {
    data = raw.data;
  } else if (raw.data?.type === 'Buffer' && Array.isArray(raw.data.data)) {
    data = Buffer.from(raw.data.data);
  } else if (Array.isArray(raw.data)) {
    data = Buffer.from(raw.data);
  } else {
    data = Buffer.alloc(0);
  }

  return new TransactionInstruction({ programId, keys, data });
}

// ── Build a single VersionedTransaction (no signing) ─────────────────────────
function buildTransaction(rawInstructions, blockhash, payerPublicKey) {
  const instructions = rawInstructions.map(deserialiseInstruction);

  const message = new TransactionMessage({
    payerKey:        payerPublicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

// ── Build and sign ALL sub-batch transactions in one pass ─────────────────────
export function buildAndSignAll(subBatches, blockhash, keypair) {
  // 1. Build all transactions
  const txs = subBatches.map(sub =>
    buildTransaction(sub.instructionsBatch, blockhash, keypair.publicKey)
  );

  // 2. Sign all at once — VersionedTransaction.sign accepts an array of signers
  txs.forEach(tx => tx.sign([keypair]));

  // 3. Serialise to Base64 and zip with intentIDs
  return subBatches.map((sub, i) => ({
    intentID:          sub.intentID,
    signedTransaction: Buffer.from(txs[i].serialize()).toString('base64'),
  }));
}
