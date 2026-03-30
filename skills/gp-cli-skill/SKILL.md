---
name: gp-cli-skill
description: >-
  Close empty Solana SPL token accounts and reclaim locked rent SOL back
  to your wallet, track Ghost Point earnings, claim SOUL tokens at the end
  of each weekly epoch, manage multiple encrypted wallets, and view
  lifetime and per-epoch stats — all from the command line. Use when the
  user wants to reclaim SOL from empty token accounts, check how many Ghost
  Points they've earned, claim SOUL rewards, inspect epoch standings, or
  manage their saved Solana wallets for the Graveyard Protocol.
license: Proprietary — see LICENSE.md
metadata:
  author: graveyardprotocol
  version: 1.2.0
  openclaw:
    requires:
      bins:
        - node
        - npx
---

# Graveyard Protocol CLI (gp-cli)

> [!IMPORTANT]
> **This SKILL defines and limits the commands any agent can execute.**
> The gp-cli has `--json` mode for all the commands. The agent MUST NOT run interactive prompts. To achieve this, always append `--json` to your commands.

`gp-cli` is a command-line tool for interacting with Graveyard Protocol on
Solana. It scans your wallets for empty SPL token accounts, closes them in
batches, and returns the locked rent SOL to you — keeping ~80% for you and
taking a 20% protocol fee. Ghost Points are earned per closed account and
accumulate toward weekly SOUL token distributions.

Private Keys live locally on disk and not transmitted anywhere at anytime, encrypted with AES-256-GCM (unencrypted in agent configuration).

## Install and Set up

```bash
npm install -g @graveyardprotocol/gp-cli
```

If installed globally, use the
shorter `gp` command:

```bash
gp add-wallet --keypair-file id.json --no-pwd --json
```

Requires Node.js >= 20.

## Add a Wallet

You can add as many wallets you want to manage. Wallets are stored locally in `~/.gp-cli/wallets.json`. All key formats are accepted while adding the wallets.

```bash
gp add-wallet --keypair-file ~/.config/solana/id.json --name "Main Wallet"--no-pwd --json # from keypair file
gp add-wallet --private-key "5Jxyz..." --name "Main" --no-pwd --json  # Base58 inline
gp add-wallet --private-key [66,108,100,125,...] --name "TradeWallet" --no-pwd --json  # JSON Byte Array
```

By default the keypair is encrypted with a password you choose (AES-256-GCM,
PBKDF2 key derivation). So you must pass `--no-pwd` to store unencrypted for fully
automated pipelines — ensure `~/.gp-cli/wallets.json` has appropriate
filesystem permissions.

Both formats are accepted for `--private-key`:

| Format | Example |
|---|---|
| JSON byte array | `[66, 108, 100, 125, ...]` — exported by Phantom / Solflare |
| Base58 string | `5Jxyz...` — some wallet exporters |

```bash
gp list-wallets --json                      # show all saved wallets
gp remove-wallet --wallet <address> --json  # remove wallet
```

## Close Empty Token Accounts

Scan a wallet for empty SPL token accounts and close them, returning locked
rent to the wallet.

```bash
gp close-empty --wallet <address> --yes --json    # target a specific walletskip confirmation prompt
gp close-empty --all -y --json                 # all saved wallets, auto-confirm
gp close-empty --wallet <address> --dry-run --yes --json  # preview — no transactions sent
gp close-empty --wallet <address> --verbose -y --json  # show per-batch sub-step detail
```

The CLI never broadcasts to Solana directly. Signing happens locally; the
signed transactions are handed to the Graveyard Protocol backend which
simulates, submits, and confirms them.

**Flow:**
1. User adds as many wallets they want to manage.
2. Based on the command, Backend scans the wallet(s) on-chain for empty token accounts
3. CLI shows a scan summary (accounts found, SOL to reclaim, protocol fee, Ghost Points to earn) and asks for confirmation
4. Backend builds instruction batches; CLI signs each batch locally
5. Backend submits batches of signed transactions and returns results

**Protocol economics per batch:**

| Item | Value |
|---|---|
| Protocol fee | 20% of reclaimed rent |
| You receive | ~80% of total locked SOL |
| Ghost Points | 100 points per closed account |
| Average rent per account | ~0.00204 SOL |

## Check Stats

Show Ghost Point earnings, SOL reclaimed, and SOUL allocations for the
current and previous epoch, plus lifetime totals.

```bash
gp stats --wallet <address> --json           # specific wallet (saved or any address)
gp stats --all --json                        # summary JSON for all saved wallets
gp stats --wallet <address> --yes --json     # auto-write CSV without prompting
gp stats --wallet <address> --csv-out ~/report.csv --json   # write CSV to path
```

Stats output includes:

- **Lifetime:** total accounts closed, total SOL recovered, total SOUL claimed
- **Current epoch:** accounts closed, SOL earned, Ghost Points, Ghost share %
- **Previous epoch:** same fields, plus SOUL allocated and claim state

Epochs run weekly starting Monday 00:00 UTC.

## Claim SOUL Tokens

At the close of each weekly epoch, SOUL tokens are distributed
proportionally based on each wallet's share of total Ghost Points earned.
Use `gp claim-soul` to claim them on-chain.

```bash
gp claim-soul --wallet <address> --json      # specific wallet
gp claim-soul --all --json                   # claim for all saved wallets
gp claim-soul --wallet <address> --dry-run --json  # preview amount — no tx sent
```

**Important:** SOUL transfers are signed and submitted entirely by the
Graveyard Protocol backend Community Wallet — no local keypair signing is
required. Your wallet only needs to be saved locally.

Before claiming, the CLI shows:
- Epoch period
- Accounts closed and SOL earned that epoch
- Your Ghost Points and share % of the epoch total
- SOUL amount to be claimed

## Agent / CI Usage

Use `--no-pwd` when adding wallets so no password is ever required at
runtime. Combine `--wallet`, `--yes`, and `--json` for fully unattended
pipelines.

```bash
# Add a wallet non-interactively
gp add-wallet --keypair-file ~/.config/solana/id.json --no-pwd --name "Bot" --json

# Close empty accounts — auto-confirm, JSON output
gp close-empty --wallet <address> --yes --json

# Close for all wallets
gp close-empty --all --yes --json

# Fetch stats as JSON
gp stats --wallet <address> --json
gp stats --all --json

# Claim SOUL (auto-confirms in JSON mode)
gp claim-soul --wallet <address> --json
gp claim-soul --all --json
```

## Structured Output

Every command supports `--json` for machine-readable output. The default
human-readable output uses ANSI formatting, tables, and colour — suitable
for direct reading. Use `--json` when scripting or chaining commands.

When `--all` is used with `close-empty`, one JSON object is emitted per
wallet as it completes (newline-delimited JSON), so results can be streamed
and parsed in real time.

**`gp add-wallet --json`**
```json
{ "success": true, "publicKey": "...", "encrypted": false, "name": "Bot" }
```

**`gp list-wallets --json`**
```json
{
  "success": true,
  "wallets": [{ "publicKey": "...", "name": "Bot", "encrypted": false }]
}
```

**`gp close-empty --json`**
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

**`gp stats --json`**
```json
{
  "success": true,
  "wallets": [{
    "walletAddress": "...",
    "description": "",
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
  }]
}
```

**`gp claim-soul --json`**
```json
{
  "success": true,
  "wallets": [{
    "wallet": "...",
    "status": "claimed",
    "epochStartDate": 20260317,
    "soulClaimed": 1.234567,
    "txSignature": "..."
  }]
}
```

**`claim-soul` status values:**

| Status | Meaning |
|---|---|
| `claimed` | SOUL successfully claimed on-chain |
| `dry_run` | Dry-run preview — no transaction submitted |
| `already_claimed` | SOUL was already claimed for this epoch |
| `in_progress` | A claim is currently in flight |
| `no_soul` | No SOUL allocated for this wallet this epoch |
| `no_epoch` | No previous epoch data found |
| `aborted` | User declined the interactive confirm prompt |
| `error` | Unexpected failure — see `.error` field |

On any error:
```json
{ "success": false, "error": "..." }
{ "success": false, "wallet": "...", "error": "..." }
```

## Epochs & Ghost Points

Epochs run weekly, starting Monday 00:00 UTC. Ghost Points are earned at
100 points per closed account, plus a 10% referral bonus on referred users'
points. At epoch close, SOUL tokens are distributed proportionally based on
each wallet's share of total Ghost Points.

Use `gp stats` to track your Ghost share % before the epoch closes, and
`gp claim-soul` to collect SOUL in the following epoch.

## Tips

- **Check before closing.** Use `--dry-run` on `close-empty` first to see
  exactly how many accounts will be closed and how much SOL you'll receive
  before any transaction is submitted.
- **`--json` requires `--wallet` or `--all`.** In JSON mode the interactive
  wallet picker is suppressed. Always pass an explicit wallet address or
  `--all` flag.
- **`--json` auto-confirms.** In JSON mode the "close accounts?" and "claim
  SOUL?" prompts are skipped — transactions proceed automatically. Use
  `--dry-run` first if you want to inspect before committing.
- **No local signing for SOUL claims.** `gp claim-soul` does not require
  unlocking your keypair. The backend handles signing entirely. Saved wallet
  metadata is sufficient.
- **Encrypted wallets prompt for a password at close time.** If running
  `close-empty` in CI, use `--no-pwd` wallets to avoid interactive password
  prompts. If you forget an encryption password, remove and re-add the
  wallet — on-chain history and funds are unaffected.
- **`epochStartDate` is an integer in `YYYYMMDD` format** — e.g. `20260317`
  means 17 March 2026. Parse it as a string when formatting dates.
- **`solReclaimed` is already net of the 20% protocol fee** in the
  `close-empty` JSON output. The `batchRentSol` fields in `results[]` also
  reflect the net amount returned to the wallet.

## Security Model

Private keys are stored as entries in `~/.gp-cli/wallets.json`. In Agent/CI mode, the keys are plain json, stored with `chmod 600` 
The CLI reads them
at transaction-signing time only. Keys are never printed to stdout or
exposed as environment variables.

An agent using this tool cannot read raw keys without explicitly
opening `~/.gp-cli/wallets.json` which requires the
user's approval with standard permissions settings.

This model does not provide any protection against any tool, MCP server, or script
running under the same OS user account which it can read `~/.gp-cli/wallets.json`
directly. For agent-driven workflows, use dedicated wallets with limited
SOL balances, and restrict filesystem access to `~/.gp-cli/` wherever
possible.

## Troubleshooting

**"Scan cache expired — please rescan"**
The batch count endpoint returned 0 after a successful scan. You may need to run
`gp close-empty` again — the cache has a short TTL.

**"No empty token accounts found"**
The wallet has no empty SPL token accounts to close. Nothing to do.

**"Failed to decrypt wallet — incorrect password or corrupted entry"**
Wrong password entered, or the wallet entry is corrupted. Run
`gp remove-wallet` and `gp add-wallet` to re-add the wallet.

**Network errors / `Non-JSON response`**
The Graveyard Protocol API at `https://api.graveyardprotocol.io` was
unreachable or returned an unexpected response. Check connectivity and
retry.

**`--json` mode errors out before prompting**
JSON mode suppresses all interactive prompts. Ensure `--wallet <address>`
or `--all` is passed, and for `add-wallet` use `--no-pwd` (encrypted wallets
cannot be added non-interactively in JSON mode).
