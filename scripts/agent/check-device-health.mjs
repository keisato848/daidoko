import { spawnSync } from 'node:child_process';
import { resolveAdbPath, getDevices } from './lib/adb.mjs';
import { SIGNAL_CODES, createSignal } from './lib/android-signals.mjs';

const jsonMode = process.argv.includes('--json');
const deviceIdx = process.argv.indexOf('--device');
const targetSerial = deviceIdx !== -1 && process.argv[deviceIdx + 1] ? process.argv[deviceIdx + 1] : null;

const result = await checkDeviceHealth();

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  console.log(`Device health check: ${result.ok ? 'OK' : 'FAILED'}`);
  if (result.error) {
    console.log(`Error: ${result.error}`);
    if (result.signal) {
      console.log(`Signal: ${result.signal.code} (retryable: ${result.signal.retryable}, stopLoop: ${result.signal.stopLoop})`);
    }
  }
  for (const entry of result.checks) {
    console.log(`${entry.ok ? '[OK]' : '[NG]'} ${entry.label}: ${entry.detail || ''}`);
  }
}

if (!result.ok) {
  process.exitCode = 1;
}

async function checkDeviceHealth() {
  const checks = [];
  let adbPath = null;
  let serial = null;

  // 1. Resolve adb path
  try {
    adbPath = resolveAdbPath();
    checks.push({
      id: 'adb-available',
      label: 'ADB availability',
      ok: true,
      detail: `ADB path: ${adbPath}`,
    });
  } catch (error) {
    checks.push({
      id: 'adb-available',
      label: 'ADB availability',
      ok: false,
      detail: `ADB not found: ${error.message}`,
    });
    return { ok: false, error: 'ADB is not available', signal: createSignal(SIGNAL_CODES.ADB_UNAVAILABLE, error.message), checks };
  }

  // 2. Determine target device
  try {
    const devices = getDevices(adbPath);

    if (targetSerial) {
      // Find explicitly requested device
      const matched = devices.find((d) => d.serial === targetSerial);
      if (!matched) {
        checks.push({
          id: 'device-target',
          label: 'Target device resolution',
          ok: false,
          detail: `Specified device '${targetSerial}' not found in connected devices.`,
        });
        return { ok: false, error: `Device '${targetSerial}' not found`, signal: createSignal(SIGNAL_CODES.NO_CONNECTED_DEVICE, `Device ${targetSerial} not found`), checks };
      }
      if (matched.status !== 'device') {
        checks.push({
          id: 'device-target',
          label: 'Target device resolution',
          ok: false,
          detail: `Specified device '${targetSerial}' is offline or unauthorized (status: ${matched.status}).`,
        });
        const sigCode = matched.status === 'unauthorized' ? SIGNAL_CODES.DEVICE_UNAUTHORIZED : SIGNAL_CODES.DEVICE_OFFLINE;
        return { ok: false, error: `Device '${targetSerial}' is ${matched.status}`, signal: createSignal(sigCode, matched.status), checks };
      }
      serial = targetSerial;
    } else {
      // Auto-resolve: require exactly 1 authorized (status 'device') device
      if (devices.length === 0) {
        checks.push({
          id: 'device-target',
          label: 'Target device resolution',
          ok: false,
          detail: 'No connected devices found (zero devices).',
        });
        return { ok: false, error: 'No connected devices found', signal: createSignal(SIGNAL_CODES.NO_CONNECTED_DEVICE), checks };
      }

      const activeDevices = devices.filter((d) => d.status === 'device');
      
      if (activeDevices.length === 0) {
        const statusSummary = devices.map((d) => `${d.serial} (${d.status})`).join(', ');
        checks.push({
          id: 'device-target',
          label: 'Target device resolution',
          ok: false,
          detail: `No authorized devices found. Connected devices: ${statusSummary}.`,
        });
        return { ok: false, error: 'No authorized devices found', signal: createSignal(SIGNAL_CODES.NO_AUTHORIZED_DEVICE, statusSummary), checks };
      }

      if (activeDevices.length > 1) {
        const serials = activeDevices.map((d) => d.serial);
        checks.push({
          id: 'device-target',
          label: 'Target device resolution',
          ok: false,
          detail: `Multiple active devices found: ${serials.join(', ')}. Use --device <serial> to target one.`,
        });
        return { ok: false, error: 'Multiple active devices found', signal: createSignal(SIGNAL_CODES.MULTIPLE_AUTHORIZED_DEVICES, serials.join(', ')), checks };
      }

      serial = activeDevices[0].serial;
    }

    checks.push({
      id: 'device-target',
      label: 'Target device resolution',
      ok: true,
      detail: `Targeting device: ${serial}`,
    });
  } catch (error) {
    checks.push({
      id: 'device-target',
      label: 'Target device resolution',
      ok: false,
      detail: `Error resolving target device: ${error.message}`,
    });
    return { ok: false, error: 'Failed to resolve target device', signal: createSignal(SIGNAL_CODES.ADB_UNAVAILABLE, error.message), checks };
  }

  // 3. Boot completion check
  try {
    const propsToCheck = [
      { name: 'sys.boot_completed', expected: ['1'] },
      { name: 'dev.bootcomplete', expected: ['1'] },
      { name: 'init.svc.bootanim', expected: ['stopped', ''] },
    ];

    const propResults = {};
    let bootOk = true;
    const failures = [];

    for (const prop of propsToCheck) {
      const res = spawnSync(adbPath, ['-s', serial, 'shell', 'getprop', prop.name], {
        encoding: 'utf8',
        shell: false,
      });

      if (res.status !== 0 || res.error) {
        bootOk = false;
        failures.push(`${prop.name} query failed: ${res.error?.message || res.stderr.trim()}`);
        continue;
      }

      const val = res.stdout.trim();
      propResults[prop.name] = val;

      if (!prop.expected.includes(val)) {
        bootOk = false;
        failures.push(`${prop.name} is '${val}' (expected: ${prop.expected.map((e) => `'${e}'`).join(' or ')})`);
      }
    }

    if (bootOk) {
      checks.push({
        id: 'boot-completed',
        label: 'Android boot completion',
        ok: true,
        detail: `sys.boot_completed=${propResults['sys.boot_completed']}, dev.bootcomplete=${propResults['dev.bootcomplete']}, init.svc.bootanim=${propResults['init.svc.bootanim']}`,
      });
    } else {
      checks.push({
        id: 'boot-completed',
        label: 'Android boot completion',
        ok: false,
        detail: `Boot incomplete: ${failures.join(', ')}`,
      });
      return { ok: false, error: 'Android boot is not completed', signal: createSignal(SIGNAL_CODES.DEVICE_BOOT_INCOMPLETE, failures.join(', ')), checks };
    }
  } catch (error) {
    checks.push({
      id: 'boot-completed',
      label: 'Android boot completion',
      ok: false,
      detail: `Boot check error: ${error.message}`,
    });
    return { ok: false, error: 'Failed to check boot status', signal: createSignal(SIGNAL_CODES.DEVICE_BOOT_INCOMPLETE, error.message), checks };
  }

  // 4. Android services verification
  try {
    const res = spawnSync(adbPath, ['-s', serial, 'shell', 'service', 'list'], {
      encoding: 'utf8',
      shell: false,
    });

    if (res.status !== 0 || res.error) {
      checks.push({
        id: 'services-available',
        label: 'Android system services',
        ok: false,
        detail: `Failed to list services: ${res.error?.message || res.stderr.trim()}`,
      });
      return { ok: false, error: 'Failed to list services', signal: createSignal(SIGNAL_CODES.MISSING_ANDROID_SERVICE, res.error?.message || res.stderr.trim()), checks };
    }

    const output = res.stdout;
    const required = ['package', 'window', 'input'];
    const missing = [];

    for (const service of required) {
      const regex = new RegExp(`\\b${service}\\b`);
      if (!regex.test(output)) {
        missing.push(service);
      }
    }

    if (missing.length === 0) {
      checks.push({
        id: 'services-available',
        label: 'Android system services',
        ok: true,
        detail: `Found required services: ${required.join(', ')}`,
      });
    } else {
      checks.push({
        id: 'services-available',
        label: 'Android system services',
        ok: false,
        detail: `Missing required services: ${missing.join(', ')}`,
      });
      return { ok: false, error: `Missing system services: ${missing.join(', ')}`, signal: createSignal(SIGNAL_CODES.MISSING_ANDROID_SERVICE, missing.join(', ')), checks };
    }
  } catch (error) {
    checks.push({
      id: 'services-available',
      label: 'Android system services',
      ok: false,
      detail: `Services check error: ${error.message}`,
    });
    return { ok: false, error: 'Failed to check system services', signal: createSignal(SIGNAL_CODES.MISSING_ANDROID_SERVICE, error.message), checks };
  }

  return {
    ok: true,
    checks,
  };
}
