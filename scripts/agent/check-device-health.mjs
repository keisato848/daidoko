import { spawnSync } from 'node:child_process';
import { resolveAdbPath, getDevices } from './lib/adb.mjs';

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
    return { ok: false, error: 'ADB is not available', checks };
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
        return { ok: false, error: `Device '${targetSerial}' not found`, checks };
      }
      if (matched.status !== 'device') {
        checks.push({
          id: 'device-target',
          label: 'Target device resolution',
          ok: false,
          detail: `Specified device '${targetSerial}' is offline or unauthorized (status: ${matched.status}).`,
        });
        return { ok: false, error: `Device '${targetSerial}' is ${matched.status}`, checks };
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
        return { ok: false, error: 'No connected devices found', checks };
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
        return { ok: false, error: 'No authorized devices found', checks };
      }

      if (activeDevices.length > 1) {
        const serials = activeDevices.map((d) => d.serial);
        checks.push({
          id: 'device-target',
          label: 'Target device resolution',
          ok: false,
          detail: `Multiple active devices found: ${serials.join(', ')}. Use --device <serial> to target one.`,
        });
        return { ok: false, error: 'Multiple active devices found', checks };
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
    return { ok: false, error: 'Failed to resolve target device', checks };
  }

  // 3. Boot completion check
  try {
    const propsToCheck = [
      { name: 'sys.boot_completed', expected: '1' },
      { name: 'dev.bootcomplete', expected: '1' },
      { name: 'init.svc.bootanim', expected: 'stopped' },
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

      if (val !== prop.expected) {
        bootOk = false;
        failures.push(`${prop.name} is '${val}' (expected: '${prop.expected}')`);
      }
    }

    if (bootOk) {
      checks.push({
        id: 'boot-completed',
        label: 'Android boot completion',
        ok: true,
        detail: `sys.boot_completed=1, dev.bootcomplete=1, init.svc.bootanim=stopped`,
      });
    } else {
      checks.push({
        id: 'boot-completed',
        label: 'Android boot completion',
        ok: false,
        detail: `Boot incomplete: ${failures.join(', ')}`,
      });
      return { ok: false, error: 'Android boot is not completed', checks };
    }
  } catch (error) {
    checks.push({
      id: 'boot-completed',
      label: 'Android boot completion',
      ok: false,
      detail: `Boot check error: ${error.message}`,
    });
    return { ok: false, error: 'Failed to check boot status', checks };
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
      return { ok: false, error: 'Failed to list services', checks };
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
      return { ok: false, error: `Missing system services: ${missing.join(', ')}`, checks };
    }
  } catch (error) {
    checks.push({
      id: 'services-available',
      label: 'Android system services',
      ok: false,
      detail: `Services check error: ${error.message}`,
    });
    return { ok: false, error: 'Failed to check system services', checks };
  }

  return {
    ok: true,
    checks,
  };
}
