/**
 * Defines structured failure signals for Android operations (build, install, health check, e2e).
 * This allows the orchestrator to decide whether to stop the loop, retry the operation, or report a specific failure.
 */

export const SIGNAL_CODES = {
  // Device Health & ADB
  ADB_UNAVAILABLE: 'ADB_UNAVAILABLE',
  NO_CONNECTED_DEVICE: 'NO_CONNECTED_DEVICE',
  NO_AUTHORIZED_DEVICE: 'NO_AUTHORIZED_DEVICE',
  MULTIPLE_AUTHORIZED_DEVICES: 'MULTIPLE_AUTHORIZED_DEVICES',
  DEVICE_UNAUTHORIZED: 'DEVICE_UNAUTHORIZED',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  DEVICE_BOOT_INCOMPLETE: 'DEVICE_BOOT_INCOMPLETE',
  MISSING_ANDROID_SERVICE: 'MISSING_ANDROID_SERVICE',

  // Build & Install
  APK_INSTALL_FAILED: 'APK_INSTALL_FAILED',
  GRADLE_CXX_LOCK: 'GRADLE_CXX_LOCK',

  // E2E Tests
  E2E_UIAUTOMATOR_STUCK: 'E2E_UIAUTOMATOR_STUCK',
  E2E_SYSTEM_UI_INTERFERENCE: 'E2E_SYSTEM_UI_INTERFERENCE',
};

const SIGNAL_DEFINITIONS = {
  [SIGNAL_CODES.ADB_UNAVAILABLE]: {
    retryable: false,
    stopLoop: true,
    hint: 'Ensure Android SDK platform-tools are installed and accessible.',
  },
  [SIGNAL_CODES.NO_CONNECTED_DEVICE]: {
    retryable: false,
    stopLoop: true,
    hint: 'Connect a device or start an emulator.',
  },
  [SIGNAL_CODES.NO_AUTHORIZED_DEVICE]: {
    retryable: false,
    stopLoop: true,
    hint: 'Accept the USB debugging prompt on the device.',
  },
  [SIGNAL_CODES.MULTIPLE_AUTHORIZED_DEVICES]: {
    retryable: false,
    stopLoop: true,
    hint: 'Specify a target device using the --device flag.',
  },
  [SIGNAL_CODES.DEVICE_UNAUTHORIZED]: {
    retryable: false,
    stopLoop: true,
    hint: 'Accept the USB debugging prompt on the device.',
  },
  [SIGNAL_CODES.DEVICE_OFFLINE]: {
    retryable: true,
    stopLoop: true,
    hint: 'Restart the device or adb server (adb kill-server && adb start-server).',
  },
  [SIGNAL_CODES.DEVICE_BOOT_INCOMPLETE]: {
    retryable: true,
    stopLoop: true,
    hint: 'Wait for the device to finish booting.',
  },
  [SIGNAL_CODES.MISSING_ANDROID_SERVICE]: {
    retryable: false,
    stopLoop: true,
    hint: 'The device might be in a bad state. Try rebooting it.',
  },
  [SIGNAL_CODES.APK_INSTALL_FAILED]: {
    retryable: true,
    stopLoop: false,
    hint: 'Check adb install logs. Verify signature match, package match, or try using adb install -r / -d.',
  },
  [SIGNAL_CODES.GRADLE_CXX_LOCK]: {
    retryable: true,
    stopLoop: false,
    hint: 'Gradle CXX lock file issue detected. A retry is recommended.',
  },
  [SIGNAL_CODES.E2E_UIAUTOMATOR_STUCK]: {
    retryable: true,
    stopLoop: false,
    hint: 'UI Automator appears stuck. Restarting the test or device might help.',
  },
  [SIGNAL_CODES.E2E_SYSTEM_UI_INTERFERENCE]: {
    retryable: true,
    stopLoop: false,
    hint: 'System UI (e.g., ANR dialog, low battery warning) interfered with the test.',
  },
};

/**
 * Creates a structured signal object.
 * @param {string} code - The signal code from SIGNAL_CODES.
 * @param {string} message - A specific error message or raw output.
 * @returns {object} The constructed signal object.
 */
export function createSignal(code, message = '') {
  const def = SIGNAL_DEFINITIONS[code] || { retryable: false, stopLoop: false, hint: '' };
  return {
    code,
    message,
    retryable: def.retryable,
    stopLoop: def.stopLoop,
    hint: def.hint,
  };
}
