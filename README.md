# GP-CLI — Graveyard Protocol Command Line Interface

Close empty Solana SPL token accounts and reclaim the locked rent (SOL) back to your wallet.

---

## Requirements

- **Node.js 18+**
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

---

## How It Works

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

**The CLI never broadcasts to Solana directly.** Signing happens locally with your decrypted keypair; the signed transaction is handed to backend API which simulates, sends, and confirms it.

---

## Protocol Economics

| Item | Value |
|---|---|
| Protocol fee | 20% of reclaimed rent per batch |
| You receive | ~80% of total locked SOL |
| Ghost Points | 100 points per closed account |
| Average rent per account | ~0.00204 SOL |

---

## Security

- Private keys encrypted with **AES-256-GCM**
- Key derived via **PBKDF2** (SHA-256, 100,000 iterations)
- Stored at `~/.gp-cli/wallets.json` — never transmitted
- GCM authentication tag prevents ciphertext tampering

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
