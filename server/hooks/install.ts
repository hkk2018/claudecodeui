/**
 * Auto-install Claude Code UI hooks into ~/.claude/settings.json
 *
 * Only appends hooks that don't already exist. Never modifies existing hooks.
 * Hooks call our server's /api/hook-event endpoint to forward CLI events via WebSocket.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

// Hook events we want to listen to
const HOOK_EVENTS = ['Stop', 'Notification', 'PermissionRequest'] as const;

// Identifier to recognize our hooks
const HOOK_MARKER = 'claude-code-ui';

export async function installHooks(appInstallPath: string): Promise<void> {
  const hookScriptPath = path.join(appInstallPath, 'server', 'hooks', 'claude-hook.sh');

  // Verify hook script exists
  try {
    await fs.access(hookScriptPath);
  } catch {
    console.warn(`[HOOKS] Hook script not found at ${hookScriptPath}, skipping installation`);
    return;
  }

  // Read existing settings
  let settings: any = {};
  try {
    const content = await fs.readFile(SETTINGS_PATH, 'utf-8');
    settings = JSON.parse(content);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      console.log('[HOOKS] No settings.json found, creating one');
      await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
    } else {
      console.error('[HOOKS] Failed to read settings.json:', err.message);
      return;
    }
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  let installed = 0;

  for (const event of HOOK_EVENTS) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = [];
    }

    // Check if our hook already exists
    const alreadyInstalled = settings.hooks[event].some((matcher: any) =>
      matcher.hooks?.some((hook: any) =>
        hook.command?.includes(HOOK_MARKER) || hook.command?.includes('claude-hook.sh')
      )
    );

    if (alreadyInstalled) {
      continue;
    }

    // Append our hook
    settings.hooks[event].push({
      hooks: [{
        type: 'command',
        command: hookScriptPath
      }]
    });
    installed++;
  }

  if (installed > 0) {
    try {
      await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
      console.log(`[HOOKS] Installed ${installed} hook(s) into ${SETTINGS_PATH}`);
    } catch (err: any) {
      console.error('[HOOKS] Failed to write settings.json:', err.message);
    }
  } else {
    console.log('[HOOKS] All hooks already installed');
  }
}
