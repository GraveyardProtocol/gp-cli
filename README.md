# GP-CLI — Graveyard Protocol Command Line Interface
 
A command-line tool for Humans and Skill for OpenClaw, Claude Code, and AI agents 
to interact with Graveyard Protocol on Solana. It scans your wallets for empty SPL token accounts, closes them in
batches, and returns the locked rent SOL to you — keeping ~80% for you and
taking a 20% protocol fee. Ghost Points are earned per closed account and
accumulate toward weekly SOUL token distributions.

Private keys are always encrypted with AES-256-GCM and stored locally. They are never transmitted anywhere at any time.

---

## Requirements

- **Node.js 20+**
- A Solana wallet private key (JSON byte array, Base58 string, or path to a keypair file)

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

### Install as an Agent Skill

gp-cli is available as a discoverable skill for OpenClaw, Claude Code, and other LLM agents:

```bash
# Claude Code — add the marketplace, then install the plugin
/plugin marketplace add graveyardprotocol/gp-cli
/plugin install gp-cli-skill@graveyardprotocol-gp-cli

# skills.sh
npx skills add graveyardprotocol/gp-cli
```

Once installed, the agent can use gp commands directly to manage the wallets, scan and close empty token accounts, check statistics and claim rewards.


---

## Quick Start

### 1. Initialize the CLI

Before adding any wallets, you must initialize gp-cli. This configures encryption settings to protect all wallet private keys.

```bash
gp init
```

**Attention**: Restart your terminal after running `gp init` for encryption setting to take effect.

### 2. Add a wallet

```bash
gp add-wallet
```

You will be prompted for your private key. All formats are accepted:

| Format | Example |
|---|---|
| JSON byte array | `[66, 108, 100, 125 ...]` — exported by Phantom / Solflare |
| Base58 string | `5Jxyz...` — some wallet exporters |
| Keypair file path | `/path/to/id.json` or `~/.config/solana/id.json` |

Your private key is **always stored encrypted** with AES-256-GCM, derived from encryption settings configured during `gp init`.

### 3. Close empty token accounts

```bash
gp close-empty
```

You will be shown a scan summary and asked to confirm before any transaction is submitted.

### 4. Claim your SOUL tokens

```bash
gp claim-soul
```

At the end of each weekly epoch, SOUL tokens are allocated based on your Ghost Point share. Use this command to claim them to your wallet.

---

## All Commands

| Command | Description |
|---|---|
| `gp init` | Initialize the CLI and set the master encryption key |
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

## Command Reference

### `gp init`

Initialize the CLI by generating and persisting encryption settings. These settings are used to encrypt and decrypt all wallet private keys stored locally.

**Must be run once before adding any wallets.** Re-running `gp init` when wallets already exist will prompt for confirmation and re-encrypt all stored wallets with a newly generated settings.

The settings are written to your shell configuration file (e.g. `~/.zshrc`, `~/.bashrc`) as an environment variable. **Restart your terminal** after running `gp init` before using any other commands.

---

### `gp add-wallet`

Add a Solana wallet to local storage.

| Flag | Description |
|---|---|
| `--keypair-file <path>` | Path to a Solana keypair JSON file (e.g. `~/.config/solana/id.json`) |
| `--private-key <value>` | Inline private key — Base58 string or JSON byte array |
| `--name <label>` | Wallet label — skips interactive prompt |
| `--json` | Output result as machine-readable JSON |

**Prerequisites:**

`gp init` must be run and your terminal restarted before adding wallets.

**Key input (pick one):**
- `--keypair-file <path>` — path to a Solana keypair JSON file
- `--private-key <value>` — inline Base58 string or JSON byte array
- *(neither flag)* — interactive password-masked prompt

All wallet private keys are **always encrypted** (AES-256-GCM) using the master key set by `gp init`. 

`--private-key` command option is given only for user convenience and should be avoided if possible.

**`--json` output schema:**
```json
{ "success": true, "publicKey": "...", "name": "My Wallet" }
{ "success": false, "error": "..." }
```

> **Note:** In `--json` mode, `--name` and one of `--keypair-file` or `--private-key` are required.

---

### `gp remove-wallet`

Remove a saved wallet from local storage.

| Flag | Description |
|---|---|
| `--wallet <address>` | Public key of the wallet to remove |
| `--json` | Output result as machine-readable JSON |

**`--json` output schema:**
```json
{ "success": true, "publicKey": "..." }
{ "success": false, "error": "..." }
```

---

### `gp list-wallets`

List all saved wallet public keys and their labels.

| Flag | Description |
|---|---|
| `--json` | Output result as machine-readable JSON |

**`--json` output schema:**
```json
{
  "success": true,
  "wallets": [
    { "publicKey": "...", "name": "Main Wallet" }
  ]
}
```

---

### `gp close-empty`

Scan and close empty SPL token accounts, reclaiming locked rent SOL.

| Flag | Description |
|---|---|
| `--wallet <address>` | Target a specific saved wallet (skips interactive picker) |
| `--all` | Process all saved wallets in sequence |
| `-y, --yes` | Auto-confirm the "close accounts?" prompt |
| `--dry-run` | Full pipeline but skip transaction submission |
| `--verbose` | Show detailed sub-step output for each batch |
| `--json` | Output result as machine-readable JSON; suppresses all human output |

**`--json` output schema:**

One JSON object is emitted per wallet (newline-delimited when using `--all`):

```json
{
  "success": true,
  "wallet": "...",
  "dryRun": false,
  "totalBatches": 3,
  "transactionsSucceeded": 3,
  "transactionsFailed": 0,
  "accountsClosed": 42,
  "solReclaimed": 0.085764,
  "results": [
    {
      "intentID": "...",
      "txSignature": "...",
      "batchAccountsClosed": 14,
      "batchRentSol": 0.028588,
      "success": true
    }
  ]
}
```

On error:
```json
{ "success": false, "wallet": "...", "error": "..." }
```

> **Note:** `--json` mode requires `--wallet <address>` or `--all`; without one of these flags the command will error (interactive wallet picker is unavailable in JSON mode).

---

### `gp stats`

Show Ghost Point and SOL earnings for the current and previous epoch, plus lifetime stats.

| Flag | Description |
|---|---|
| `--wallet <address>` | Look up any wallet address (no saved wallet needed) |
| `--all` | Show a summary table for all saved wallets |
| `-y, --yes` | Auto-write CSV to default path (`~/gp-stats-…csv`) without prompting |
| `--csv-out <path>` | Write CSV to an explicit file path |
| `--json` | Output result as machine-readable JSON; suppresses all human output |

> **Note:** `--csv-out` and `--yes` cannot be combined with `--json`.

**`--json` output schema:**
```json
{
  "success": true,
  "wallets": [
    {
      "walletAddress": "...",
      "description": "...",
      "userStats": {
        "totalAccountsClosed": 120,
        "totalSolsRecovered": 0.244800,
        "totalSoulClaimed": 5.000000
      },
      "currentEpoch": {
        "epochStartDate": 20260324,
        "userGhostEarned": 4200,
        "userGhostReferrals": 420,
        "userGhostTotal": 4620,
        "userAccountsClosed": 42,
        "userSolsRecovered": 0.085764,
        "totalUsers": 1337,
        "totalGhostEarned": 9999999,
        "ghostSharePct": "0.0462"
      },
      "previousEpoch": {
        "epochStartDate": 20260317,
        "userGhostEarned": 3000,
        "userGhostReferrals": 300,
        "userGhostTotal": 3300,
        "userAccountsClosed": 30,
        "userSolsRecovered": 0.061200,
        "userSoul": 1.234567,
        "claimState": "No",
        "totalUsers": 1200,
        "totalGhostEarned": 8500000,
        "totalSoul": 10000.000000,
        "ghostSharePct": "0.0388"
      }
    }
  ]
}
```

On error:
```json
{ "success": false, "error": "..." }
```

**Epoch field reference:**

| Field | Description |
|---|---|
| `epochStartDate` | Epoch start as `YYYYMMDD` integer |
| `userGhostEarned` | Ghost Points earned from closed accounts |
| `userGhostReferrals` | Ghost Points earned from referrals |
| `userGhostTotal` | Combined Ghost Points (earned + referrals) |
| `userAccountsClosed` | Accounts closed this epoch |
| `userSolsRecovered` | SOL reclaimed this epoch |
| `userSoul` | SOUL tokens allocated *(previous epoch only)* |
| `claimState` | `"Yes"` / `"No"` / `"Claiming"` *(previous epoch only)* |
| `ghostSharePct` | Your % share of total epoch Ghost Points |
| `totalUsers` | Network-wide participant count |
| `totalGhostEarned` | Total Ghost Points earned across all users |
| `totalSoul` | Total SOUL allocated *(previous epoch only)* |

---

### `gp claim-soul`

Claim SOUL tokens earned in the previous epoch. The backend Community Wallet handles all on-chain signing — **no local keypair signing is required**.

| Flag | Description |
|---|---|
| `--wallet <address>` | Claim for a specific wallet address |
| `--all` | Claim for all saved wallets in sequence |
| `--dry-run` | Preview claimable SOUL without submitting a transaction |
| `--json` | Output result as machine-readable JSON; auto-confirms, suppresses human text |

**`--json` output schema:**
```json
{
  "success": true,
  "wallets": [
    {
      "wallet": "...",
      "status": "claimed",
      "epochStartDate": 20260317,
      "soulClaimed": 1.234567,
      "txSignature": "..."
    }
  ]
}
```

On error:
```json
{ "success": false, "error": "..." }
```

**`status` values:**

| Status | Meaning |
|---|---|
| `claimed` | SOUL successfully claimed on-chain |
| `dry_run` | Dry-run preview only — no transaction submitted |
| `already_claimed` | SOUL was already claimed for this epoch |
| `in_progress` | A claim transaction is currently in flight |
| `no_soul` | No SOUL allocated for this wallet this epoch |
| `no_epoch` | No previous epoch data found |
| `aborted` | User declined the interactive confirm prompt |
| `error` | Unexpected failure — see `.error` field |

> **Note:** In `--json` mode, the confirmation prompt is suppressed and the claim is submitted automatically. Use `--dry-run` first to verify the amount before running live.

---

## Agent / CI Usage

For automated pipelines, run `gp init` once during environment setup  in the agent's shell session.

Combine `--wallet`, `--all`, `--yes`, and `--json` for fully unattended pipelines.

**Example pipeline:**

```bash
# Step 1: Initialize once (restart terminal / source shell config after)
gp init

# Add a wallet non-interactively
gp add-wallet --keypair-file ~/.config/solana/id.json --name "Bot Wallet" --json

# Close empty accounts for one wallet, auto-confirm, JSON output
gp close-empty --wallet <address> --yes --json

# Close empty accounts for all saved wallets
gp close-empty --all --yes --json

# Fetch stats for all wallets as JSON
gp stats --all --json

# Claim SOUL for all wallets (auto-confirms in JSON mode)
gp claim-soul --all --json
```

JSON output is **newline-delimited** when `--all` is used with `close-empty`, making it easy to stream and parse per-wallet results in real time.

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

- Encryption settings are generated by `gp init` and stored in your shell environment
- Private keys are encrypted with **AES-256-GCM** (PBKDF2 key derivation,
100 000 iterations)
- Stored at `~/.gp-cli/wallets.json` — never transmitted
- GCM authentication tag prevents ciphertext tampering
- Private keys are never logged or printed to stdout
- SOUL claims require no local signing — the backend Community Wallet handles the transfer

---

## Local Storage

| Path | Contents |
|---|---|
| `~/.gp-cli/wallets.json` | AES-256-GCM encrypted wallet entries |

---

## Disclaimer

This software interacts with the Solana blockchain and can execute irreversible transactions involving real funds. You are solely responsible for your own transactions, wallet security, and any financial outcomes. The authors are not liable for any losses. Use at your own risk.

---

## License

**Graveyard Protocol CLI** (gp-cli) is proprietary software. All rights reserved.

The use of this software is governed by the **Proprietary Software License Agreement** found in the LICENSE file included in this repository.

**Commercial Use:** Permitted under the terms of the license.

**Modification/Redistribution:** Strictly prohibited.

**Reverse Engineering:** Strictly prohibited.

For third-party library attributions, please refer to the `THIRD_PARTY_LICENSES` file generated in the distribution.


---
**Note:** The source code provided in this repository is for transparency and auditing purposes only. It does not constitute an Open Source grant.