/**
 * @license
 * Graveyard Protocol CLI
 * Copyright (c) 2026 Graveyard Protocol. All rights reserved.
 * This software and its source code are proprietary. 
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import path from 'path';
import os from 'os';

// ── API ───────────────────────────────────────────────────────────────────────
export const API_BASE_URL = 'https://api.graveyardprotocol.io';
export const STORAGE_DIR  = path.join(os.homedir(), '.gp-cli');
export const STORAGE_FILE = path.join(STORAGE_DIR, 'wallets.json');

// ── Protocol constants - FOR INFORMATION ONLY──────────────────────────────────
// These parameters are handled in the backend.
// export const BASE_GHOST_POINTS    = 100;
// export const PROTOCOL_FEE_PERCENT = 0.20;   // 20%
// export const REAPER_FEE_RECIPIENT = 'GRAVEbqZNUN1K7WBgvwgWUYs69M51eprZbSkeXWbQjjE';
