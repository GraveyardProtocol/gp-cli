# GP-CLI — Graveyard Protocol Command Line Interface

Close empty Solana SPL token accounts and reclaim the locked rent (SOL) back to your wallet.

---

## Requirements

- **Node.js 20+**
- A Solana wallet private key (JSON byte array or Base58 string)

---

## Installation

```bash
npm install -g @graveyardprotocol/gp-cli
```

Or run directly from the repo:

```bash
git clone https://github.com/GraveyardProtocol/gp-cli
cd gp-cli
npm install
npm link          
```

---

## Quick Start

### 1. Add a wallet

```bash
gp add-wallet
```

You will be prompted for your private key. Both formats are accepted:

| Format | Example |
|---|---|
| JSON byte array | `[12, 34, 56, ...]` — exported by Phantom / Solflare |
| Base58 string | `5Jxyz...` — some wallet exporters |

Your private key is **never stored in plaintext**. It is encrypted with AES-256-GCM using a password you choose, and stored in `~/.gp-cli/wallets.json`.

### 2. Close empty token accounts

```bash
gp close-empty
```

You will be shown a scan summary and asked to confirm before any transaction is submitted.

### 3. Claim your SOUL tokens

```bash
gp claim-soul
```

At the end of each weekly epoch, SOUL tokens are allocated based on your Ghost Point share. Use this command to claim them to your wallet.

---

## All Commands

| Command | Description |
|---|---|
| `gp add-wallet` | Add and encrypt a Solana wallet |
| `gp remove-wallet` | Remove a saved wallet |
| `gp list-wallets` | Show all saved wallet public keys |
| `gp close-empty` | Scan and close empty token accounts |
| `gp close-empty --dry-run` | Preview what would be closed — no transactions sent |
| `gp close-empty --all` | Process every saved wallet in sequence |
| `gp stats` | Show Ghost Point and SOL earnings for current and previous epoch |
| `gp stats --all` | Show stats for all saved wallets in a summary table |
| `gp stats --wallet <address>` | Look up any wallet address directly (no saved wallet needed) |
| `gp claim-soul` | Claim SOUL tokens earned in the previous epoch |
| `gp claim-soul --all` | Claim for all saved wallets in sequence |
| `gp claim-soul --dry-run` | Preview claimable SOUL without submitting a transaction |

---

## How It Works

### Closing Empty Token Accounts

```
CLI                           Backend                      Solana
 │                               │                            │
 ├─ gp close-empty               │                            │
 │                               │                            │
 ├──── GET /scan/{wallet} ───────►                            │
 │◄─── { total_accounts, SOL } ──┤  scans on-chain ──────────►
 │                               │◄─ results ─────────────────┤
 │                               │                            │
 ├──── GET /getBatchCount ───────►                            │
 │◄─── { totalBatches } ─────────┤                            │
 │                               │                            │
 ├──── POST /processBatch ───────►                            │
 │◄─── { intentID,              ─┤  builds instructions       │
 │       instructionsBatch }     │                            │
 │                               │                            │
 ├── build Tx, sign locally ─────►                            │
 │                               │                            │
 ├──── POST /executeBatch ───────►                            │
 │◄─── { txSignature, SOL } ─────┤  simulates + submits ──────►
 │                               │◄─ confirmed ───────────────┤
```

**The CLI never broadcasts to Solana directly.** Signing happens locally with your decrypted keypair; the signed transaction is handed to the backend API which simulates, sends, and confirms it.

### Claiming SOUL Tokens

```
CLI                           Backend                      Solana
 │                               │                            │
 ├─ gp claim-soul                │                            │
 │                               │                            │
 ├──── GET /epoch/data/{wallet} ─►                            │
 │◄─── { previousEpoch: {       ─┤                            │
 │       userSoul, claimState } }│                            │
 │                               │                            │
 ├── show summary, confirm ──────►                            │
 │                               │                            │
 ├──── POST /soul/claim ─────────►                            │
 │◄─── { txSignature } ──────────┤  builds ATA + transfer ───►
 │                               │◄─ confirmed ───────────────┤
```

SOUL transfers are signed and submitted entirely by the backend using the Community Wallet — **no signing is required from your keypair**.

---

## Protocol Economics

| Item | Value |
|---|---|
| Protocol fee | 20% of reclaimed rent per batch |
| You receive | ~80% of total locked SOL |
| Ghost Points | 100 points per closed account |
| Referral bonus | 10% of referred user's Ghost Points credited to referrer |
| Average rent per account | ~0.00204 SOL |

### Epochs & SOUL Distribution

Epochs run weekly, starting Monday 00:00 UTC. At the close of each epoch, SOUL tokens are distributed proportionally based on each participant's share of total Ghost Points earned. Use `gp stats` to track your share before claiming.

---

## Security

- Private keys encrypted with **AES-256-GCM**
- Key derived via **PBKDF2** (SHA-256, 100,000 iterations)
- Stored at `~/.gp-cli/wallets.json` — never transmitted
- GCM authentication tag prevents ciphertext tampering
- SOUL claims require no local signing — the backend community wallet handles the transfer

---

## Local Storage

| Path | Contents |
|---|---|
| `~/.gp-cli/wallets.json` | Encrypted wallet entries |

---

**Note:** The source code provided in this repository is for transparency and auditing purposes only. It does not constitute an Open Source grant.

---

## License

**Graveyard Protocol CLI** (gp-cli) is proprietary software. All rights reserved.

The use of this software is governed by the **Proprietary Software License Agreement** found in the LICENSE file included in this repository.

**Commercial Use:** Permitted under the terms of the license.

**Modification/Redistribution:** Strictly prohibited.

**Reverse Engineering:** Strictly prohibited.

For third-party library attributions, please refer to the THIRD_PARTY_LICENSES file generated in the distribution.
