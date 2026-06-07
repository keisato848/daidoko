import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { join } from 'node:path';

function adbExecutable() {
  return platform() === 'win32' ? 'adb.exe' : 'adb';
}

export const adbCandidates = [
  process.env.ADB_PATH,
  process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'platform-tools', adbExecutable()),
  process.env.ANDROID_SDK_ROOT &&
    join(process.env.ANDROID_SDK_ROOT, 'platform-tools', adbExecutable()),
  process.env.LOCALAPPDATA &&
    join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', adbExecutable()),
  'adb',
].filter(Boolean);

/**
 * Resolves the path to the adb executable.
 * Returns the resolved path (could be a full path or just 'adb'), or throws an error.
 */
export function resolveAdbPath() {
  const attempts = [];
  for (const candidate of adbCandidates) {
    const result = spawnSync(candidate, ['version'], {
      encoding: 'utf8',
      shell: false,
    });
    if (result.status === 0 && !result.error) {
      return candidate;
    }
    attempts.push(candidate);
  }
  throw new Error(`adb not found. Tried: ${attempts.join(', ')}`);
}

/**
 * Returns a list of connected devices parsed from `adb devices`.
 * Each device is { serial: string, status: string }.
 * status is usually 'device', 'unauthorized', 'offline', etc.
 */
export function getDevices(adbPath) {
  const result = spawnSync(adbPath, ['devices'], {
    encoding: 'utf8',
    shell: false,
  });

  if (result.status !== 0 || result.error) {
    throw new Error(`Failed to execute adb devices: ${result.error?.message || result.stderr}`);
  }

  const lines = result.stdout.split(/\r?\n/);
  const devices = [];

  // The first line is usually "List of devices attached"
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('List of devices')) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      devices.push({
        serial: parts[0],
        status: parts[1], // 'device', 'unauthorized', 'offline', etc.
      });
    }
  }

  return devices;
}
