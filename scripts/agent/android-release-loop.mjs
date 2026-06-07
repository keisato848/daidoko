import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRetryPolicy } from './lib/android-retry-policy.mjs';
import { executeRecovery } from './lib/android-recovery-executor.mjs';

import { runCommand } from './lib/runtime.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const options = parseArgs(process.argv.slice(2));
const steps = [];
const recoveryAttempts = [];

steps.push(runStepWithRecovery('preflight', [process.execPath, 'scripts/agent/preflight.mjs', '--json']));

const needsDevice = !options.skipInstall || !options.skipE2e;
let healthOk = true;

if (needsDevice) {
  const healthArgs = [process.execPath, 'scripts/agent/check-device-health.mjs', '--json'];
  if (options.device) {
    healthArgs.push('--device', options.device);
  }
  const healthStep = runStepWithRecovery('device-health', healthArgs, undefined, options.device);
  steps.push(healthStep);
  if (!healthStep.ok) {
    healthOk = false;
  }
}

if (!options.skipBuild && healthOk) {
  steps.push(
    runStepWithRecovery('build', [
      process.execPath,
      'scripts/agent/build-android.mjs',
      '--arch',
      options.arch,
      '--json',
    ], undefined, options.device),
  );
}

if (!options.skipInstall && healthOk) {
  const installArgs = [process.execPath, 'scripts/agent/install-apk.mjs', '--json'];
  if (options.device) {
    installArgs.push('--device', options.device);
  }
  steps.push(runStepWithRecovery('install', installArgs, undefined, options.device));
}

if (!options.skipE2e && healthOk) {
  for (const suite of resolveSuites(options.suite)) {
    steps.push(runStepWithRecovery(suite, suiteCommand(suite), buildSuiteEnv(options.device), options.device));
  }
}

const summary = {
  ok: steps.every((step) => step.ok),
  steps,
  recoveryAttempts,
};

// If the loop failed, find the first failing step with a signal to surface the policy at the top level
if (!summary.ok) {
  const failedStepWithSignal = steps.find((step) => !step.ok && step.signal);
  if (failedStepWithSignal) {
    summary.retryPolicy = getRetryPolicy(failedStepWithSignal.signal.code);
  }
}

if (options.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(summary.ok ? 0 : 1);
}

console.log(`Android release loop: ${summary.ok ? 'OK' : 'FAILED'}`);
for (const step of steps) {
  console.log(`${step.ok ? '[OK]' : '[NG]'} ${step.id}`);
  if (step.signal) {
    console.log(`  Signal: ${step.signal.code}`);
    const policy = getRetryPolicy(step.signal.code);
    console.log(`  Action: ${policy.suggestedAction}`);
  }
  const recovery = recoveryAttempts.find((r) => r.stepId === step.id);
  if (recovery) {
    console.log(`  Recovery: ${recovery.executed ? 'EXECUTED' : 'SKIPPED'} - ${recovery.detail}`);
  }
  if (step.output && !step.output.trim().startsWith('{')) {
    console.log(step.output);
  }
}

process.exit(summary.ok ? 0 : 1);

function parseArgs(argv) {
  const parsed = {
    arch: 'arm64-v8a',
    device: '',
    suite: 'base',
    skipBuild: false,
    skipInstall: false,
    skipE2e: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--arch' && argv[index + 1]) {
      parsed.arch = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--device' && argv[index + 1]) {
      parsed.device = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--suite' && argv[index + 1]) {
      parsed.suite = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--skip-build') {
      parsed.skipBuild = true;
      continue;
    }
    if (token === '--skip-install') {
      parsed.skipInstall = true;
      continue;
    }
    if (token === '--skip-e2e') {
      parsed.skipE2e = true;
      continue;
    }
    if (token === '--json') {
      parsed.json = true;
    }
  }

  return parsed;
}

function resolveSuites(suite) {
  if (suite === 'all') {
    return ['base', 'ocr', 'photo'];
  }
  return [suite];
}

function suiteCommand(suite) {
  if (suite === 'ocr') {
    return [process.execPath, 'e2e/android-ocr-e2e.mjs'];
  }
  if (suite === 'photo') {
    return [process.execPath, 'e2e/android-photo-recipe-e2e.mjs'];
  }
  return [process.execPath, 'e2e/android-e2e.mjs'];
}

function buildSuiteEnv(device) {
  if (!device) {
    return undefined;
  }
  return { TARGET_DEVICE: device };
}

function runStepWithRecovery(id, [command, ...args], env = undefined, device = null) {
  let stepResult = runStep(id, [command, ...args], env);

  if (!stepResult.ok && stepResult.signal && stepResult.retryPolicy?.strategy === 'retry_candidate') {
    const recoveryRes = executeRecovery(stepResult.signal.code, device, 'adb', { id });
    recoveryRes.stepId = id;
    recoveryAttempts.push(recoveryRes);

    if (recoveryRes.executed && recoveryRes.rerunRecommended) {
      const retryResult = runStep(id, [command, ...args], env);
      stepResult = retryResult;
      stepResult.retried = true;
    }
  }

  return stepResult;
}

function runStep(id, [command, ...args], env = undefined) {
  const result = runCommand(command, args, { cwd: rootDir, env });
  const stepResult = {
    id,
    ok: result.ok,
    commandLine: result.commandLine,
    output: result.combinedOutput,
  };

  if (result.combinedOutput && result.combinedOutput.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(result.combinedOutput);
      if (parsed.signal) {
        stepResult.signal = parsed.signal;
        stepResult.retryPolicy = getRetryPolicy(parsed.signal.code);
      }
      if (parsed.error) {
        stepResult.error = parsed.error;
      }
    } catch (e) {
      // ignore JSON parse errors
    }
  }

  return stepResult;
}