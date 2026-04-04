/**
 * @license
 * Graveyard Protocol CLI
 * Copyright (c) 2026 Graveyard Protocol. All rights reserved.
 * This software and its source code are proprietary.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import crypto from 'crypto';
import { setMasterKey } from '../envManager.mjs';

export default async function init() {

  const key = crypto.randomBytes(32).toString('base64');

  const result = await setMasterKey('GP_CLI_MASTER_KEY', key);

  console.log(result.message);

  if (result.sourceCommand) {
    console.log(`Run:\n${result.sourceCommand}`);
  }
}