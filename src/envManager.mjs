import { exec, execSync } from 'child_process';
import { promisify } from 'util';
//import os from 'os';
import { platform, homedir } from 'os';
import path, { join, dirname } from 'path';
import fs from 'fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import inquirer from 'inquirer';
import { loadWalletFile, decryptPrivateKey, encryptPrivateKey, saveWalletFile } from './walletManager.mjs';
import { STORAGE_DIR, STORAGE_FILE } from './config.mjs';

const execAsync = promisify(exec);
let os;

/**
 * Detect user's shell configuration file
 */
function detectShellConfig() {
  const shell = process.env.SHELL || '';

  if (shell.includes('zsh')) return '.zshrc';
  if (shell.includes('bash')) return os === "darwin"
    ? '.bash_profile'
    : '.bashrc';
  if (shell.includes('fish')) return '.config/fish/config.fish';
  if (shell.includes('ksh') || shell.includes('ksh93')) return '.kshrc';
  if (shell.includes('tcsh') || shell.includes('csh')) return '.tcshrc';

  return '.profile';
}

/**
 * Idempotently write an export line to a shell config file.
 * Removes any pre-existing export for the same variable first.
 */
function writeToShellConfig(file, varName, varValue) {
  // Ensure parent directory exists (e.g. ~/.config/fish/)
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";

  // Build the export line — fish uses 'set -x', everything else uses 'export'
  const exportLine =
    (file.includes("fish"))
      ? `set -x ${varName} "${varValue}"`
      : `export ${varName}="${varValue}"`;

  // Strip any existing line for this variable (idempotent)
  const pattern =
    (file.includes("fish"))
      ? new RegExp(`^set -x ${varName} .*$`, "m")
      : new RegExp(`^export ${varName}=.*$`, "m");

  const cleaned = existing.replace(pattern, "").replace(/\n{3,}/g, "\n\n").trimEnd();

  writeFileSync(file, cleaned ? `${cleaned}\n${exportLine}\n` : `${exportLine}\n`, "utf8");
}


/**
 * Escape shell-safe value
 */
function escapeShellValue(value) {
  return value.replace(/'/g, "'\\''");
}

/**
 * Persist environment variable in USER environment only
 */
export async function setMasterKey(cliKeyName, cliKeyValue) {
  os = platform();
  const existingKey = process.env[cliKeyName];

  /* ───────────── Check existing key ───────────── */

  if (existingKey) {
    const walletFile = loadWalletFile();
    if (walletFile.wallets.length) {
      const { confirmChange } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmChange',
          message:
            'There are stored wallets. Initializing again will re-encrypt all stored wallets. Continue?',
          default: false
        }
      ]);

      if (!confirmChange) {
        return {
          success: false,
          message: 'Operation cancelled by user.'
        };
      }

      try {
        /* ───────────── Re-encrypt Wallets ───────────── */

        const updatedWallets = walletFile.wallets.map((wallet) => {
          const decrypted = decryptPrivateKey(
            wallet.encryptedPrivateKey,
            existingKey
          );

          const reEncrypted = encryptPrivateKey(decrypted, cliKeyValue);

          return {
            ...wallet,
            encryptedPrivateKey: reEncrypted
          };
        });

        const walletPath = STORAGE_FILE;
        const backupPath = path.join(STORAGE_DIR, 'wallets.bak');
        const tempPath = path.join(STORAGE_DIR, 'wallets.tmp');

        const newWalletFile = {
          ...walletFile,
          wallets: updatedWallets
        };

        /* write temp file first */
        saveWalletFile(tempPath, newWalletFile);

        /* create backup of existing wallet file */
        await fs.copyFile(walletPath, backupPath);

        /* replace original atomically */
        await fs.rename(tempPath, walletPath);

      } catch (error) {
        return {
          success: false,
          message: `Failed to re-encrypt wallets: ${error.message}`
        };
      }
    } else {
      return {
        success: false,
        message: 'gp-cli was initialized previously but no wallets were configued. No changes applied now.'
      };
    }
  }

  /* ───────────── Windows (User Environment) ───────────── */

  if (os === 'win32') {
    const safeValue = cliKeyValue.replace(/"/g, '\\"');
    const command = `setx ${cliKeyName} "${safeValue}"`;

    try {
      await execAsync(command);

      return {
        success: true,
        message:
          'Command completed successfully. Restart your terminal before running gp-cli commands.',
        requiresRestart: true
      };
    } catch (error) {
      return {
        success: false,
        message: `Initialization failed: ${error.message}`
      };
    }
  }

  /* ───────────── macOS / Linux ───────────── */

  try {
    // const shell = process.env.SHELL || '';
    const home = homedir();
    let rcFile = path.join(home, detectShellConfig());

    // const safeValue = cliKeyValue.replace(/"/g, '\\"');
    // const command = `echo 'export ${cliKeyName}="${safeValue}"' >> ${rcFile}`;

    // await execAsync(command);
    writeToShellConfig(rcFile, cliKeyName, cliKeyValue)

    return {
      success: true,
      message:
        'Command completed successfully. Restart your terminal before running gp-cli commands.',
      requiresRestart: true
    };
  } catch (error) {
    return {
      success: false,
      message: `Initialization failed: ${error.message}`
    };
  }
}

/**
 * Remove environment variable from USER environment
 */
export async function removeMasterKey(key) {
  const os = platform();

  /* ───────────── Windows ───────────── */

  if (os === 'win32') {
    try {
      await execAsync(`setx ${key} ""`);

      return {
        success: true,
        message: 'Command completed successfully. Restart terminal to apply.'
      };
    } catch (error) {
      return {
        success: false,
        message: `Command failed: ${error.message}`
      };
    }
  }

  /* ───────────── macOS / Linux ───────────── */

  const home = homedir();
  const configs = [
    '.bashrc',
    '.zshrc',
    '.profile',
    '.bash_profile'
  ];

  try {
    for (const fileName of configs) {
      const file = join(home, fileName);

      let content;

      try {
        content = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }

      const updated = content.replace(
        new RegExp(`^\\s*export\\s+${key}=.*\\n?`, 'gm'),
        ''
      );

      if (updated !== content) {
        await fs.writeFile(file, updated);
      }
    }

    return {
      success: true,
      message:
        'Environment variable removed from user shell configs. Restart terminal to apply.'
    };

  } catch (error) {
    return {
      success: false,
      message: `Failed to remove variable: ${error.message}`
    };
  }
}