import { spawnSync } from 'node:child_process';
import { SIGNAL_CODES } from './android-signals.mjs';
import { getRetryPolicy } from './android-retry-policy.mjs';

/**
 * Executes an automated recovery action based on the given signal.
 * Limits execution to safe, non-destructive actions.
 * 
 * @param {string} signalCode - The failure signal code.
 * @param {string} device - The target device serial (if applicable).
 * @param {string} adbPath - Resolved adb executable path.
 * @param {object} context - Additional context (step kind, raw output, etc.).
 * @returns {object} Recovery execution result.
 */
export function executeRecovery(signalCode, device, adbPath = 'adb', context = {}) {
  const policy = getRetryPolicy(signalCode);
  
  const result = {
    executed: false,
    skipped: true,
    strategy: policy.strategy,
    action: policy.suggestedAction,
    commands: [],
    ok: false,
    detail: '',
    rerunRecommended: false,
  };

  // We only auto-recover specific retry candidates.
  if (policy.strategy !== 'retry_candidate') {
    result.detail = 'Strategy is not retry_candidate. Manual intervention required.';
    return result;
  }

  // Safe recovery implementations
  switch (signalCode) {
    case SIGNAL_CODES.DEVICE_BOOT_INCOMPLETE:
      return recoverBootIncomplete(device, adbPath, result);

    case SIGNAL_CODES.E2E_SYSTEM_UI_INTERFERENCE:
      return recoverSystemUiInterference(device, adbPath, result);

    default:
      // Known retry candidates that are not auto-executed in this version
      // (e.g., DEVICE_OFFLINE, GRADLE_CXX_LOCK, E2E_UIAUTOMATOR_STUCK)
      result.detail = `Auto-recovery not implemented for ${signalCode}. Follow suggested action.`;
      return result;
  }
}

function recoverBootIncomplete(device, adbPath, baseResult) {
  if (!device) {
    baseResult.detail = 'Device serial not provided.';
    return baseResult;
  }

  baseResult.executed = true;
  baseResult.skipped = false;
  baseResult.action = 'Waiting briefly for boot completion properties...';
  
  const propsToCheck = ['sys.boot_completed', 'dev.bootcomplete', 'init.svc.bootanim'];
  baseResult.commands = propsToCheck.map(p => `adb shell getprop ${p}`);

  const maxWaitMs = 10000;
  const pollIntervalMs = 2000;
  const start = Date.now();

  let bootOk = false;
  let lastFailures = [];

  while (Date.now() - start < maxWaitMs) {
    let allOk = true;
    lastFailures = [];

    for (const prop of propsToCheck) {
      const res = spawnSync(adbPath, ['-s', device, 'shell', 'getprop', prop], { encoding: 'utf8' });
      const val = res.stdout ? res.stdout.trim() : '';
      
      const expected = prop === 'init.svc.bootanim' ? 'stopped' : '1';
      if (val !== expected) {
        allOk = false;
        lastFailures.push(`${prop}=${val}`);
      }
    }

    if (allOk) {
      bootOk = true;
      break;
    }

    // Wait before next poll
    spawnSync('node', ['-e', `setTimeout(() => {}, ${pollIntervalMs})`]);
  }

  baseResult.ok = bootOk;
  if (bootOk) {
    baseResult.detail = 'Boot properties are now reporting ready.';
    baseResult.rerunRecommended = true;
  } else {
    baseResult.detail = `Boot still incomplete after wait: ${lastFailures.join(', ')}`;
    baseResult.rerunRecommended = false;
  }

  return baseResult;
}

function recoverSystemUiInterference(device, adbPath, baseResult) {
  if (!device) {
    baseResult.detail = 'Device serial not provided.';
    return baseResult;
  }

  baseResult.executed = true;
  baseResult.skipped = false;
  baseResult.action = 'Dismissing System UI overlays and waking up screen.';
  
  const recoveryCmds = [
    ['shell', 'cmd', 'statusbar', 'collapse'],
    ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'],
    ['shell', 'wm', 'dismiss-keyguard'],
  ];

  baseResult.commands = recoveryCmds.map(cmd => `adb ${cmd.join(' ')}`);

  let successCount = 0;
  let errorDetails = [];

  for (const cmdArgs of recoveryCmds) {
    const res = spawnSync(adbPath, ['-s', device, ...cmdArgs], { encoding: 'utf8' });
    if (res.status === 0 && !res.error) {
      successCount++;
    } else {
      errorDetails.push(`${cmdArgs.join(' ')} failed: ${res.error?.message || res.stderr.trim()}`);
    }
  }

  baseResult.ok = (successCount === recoveryCmds.length);
  baseResult.detail = baseResult.ok 
    ? 'System UI overlays dismissed successfully.' 
    : `Failed some recovery commands: ${errorDetails.join(', ')}`;
  
  // Even if some failed, it might be worth rerunning the test.
  baseResult.rerunRecommended = true;

  return baseResult;
}
