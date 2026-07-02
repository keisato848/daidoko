import { SIGNAL_CODES } from './android-signals.mjs';

/**
 * Returns a structured retry policy for a given failure signal.
 * 
 * Policy structure:
 * - strategy: 'stop', 'manual_first', 'retry_candidate'
 * - maxAttempts: integer (0 if stop)
 * - requiresHuman: boolean
 * - suggestedAction: string (user-friendly description of what to do)
 * - suggestedChecks: array of strings (commands or checks to perform)
 */
export function getRetryPolicy(signalCode) {
  switch (signalCode) {
    case SIGNAL_CODES.ADB_UNAVAILABLE:
      return {
        strategy: 'stop',
        maxAttempts: 0,
        requiresHuman: true,
        suggestedAction: 'Ensure Android SDK platform-tools are installed and added to your PATH.',
        suggestedChecks: ['adb version'],
      };

    case SIGNAL_CODES.NO_CONNECTED_DEVICE:
      return {
        strategy: 'stop',
        maxAttempts: 0,
        requiresHuman: true,
        suggestedAction: 'Connect a physical device via USB or start an Android emulator.',
        suggestedChecks: ['adb devices'],
      };

    case SIGNAL_CODES.NO_AUTHORIZED_DEVICE:
    case SIGNAL_CODES.DEVICE_UNAUTHORIZED:
      return {
        strategy: 'stop',
        maxAttempts: 0,
        requiresHuman: true,
        suggestedAction: 'Check your device screen and accept the "Allow USB debugging" prompt.',
        suggestedChecks: ['adb devices'],
      };

    case SIGNAL_CODES.MULTIPLE_AUTHORIZED_DEVICES:
      return {
        strategy: 'stop',
        maxAttempts: 0,
        requiresHuman: true,
        suggestedAction: 'Specify which device to target using the --device <serial> argument.',
        suggestedChecks: ['adb devices'],
      };

    case SIGNAL_CODES.DEVICE_OFFLINE:
      return {
        strategy: 'retry_candidate',
        maxAttempts: 3,
        requiresHuman: false,
        suggestedAction: 'Restart the adb server and device connection.',
        suggestedChecks: ['adb kill-server', 'adb start-server'],
      };

    case SIGNAL_CODES.DEVICE_BOOT_INCOMPLETE:
      return {
        strategy: 'retry_candidate',
        maxAttempts: 5,
        requiresHuman: false,
        suggestedAction: 'Wait for the device boot sequence to complete.',
        suggestedChecks: ['adb shell getprop sys.boot_completed'],
      };

    case SIGNAL_CODES.MISSING_ANDROID_SERVICE:
      return {
        strategy: 'stop',
        maxAttempts: 0,
        requiresHuman: true,
        suggestedAction: 'The device is in a bad state and missing core services. Reboot the device.',
        suggestedChecks: ['adb reboot'],
      };

    case SIGNAL_CODES.GRADLE_CXX_LOCK:
      return {
        strategy: 'retry_candidate',
        maxAttempts: 2,
        requiresHuman: false,
        suggestedAction: 'Stop Gradle daemons and clear the CXX lock files.',
        suggestedChecks: [
          'cd apps/mobile/android && ./gradlew --stop',
          'Remove .cxx directories in the build folder',
        ],
      };

    case SIGNAL_CODES.APK_INSTALL_FAILED:
      return {
        strategy: 'manual_first',
        maxAttempts: 1,
        requiresHuman: true,
        suggestedAction: 'Review the raw adb install output. Check for signature mismatch, package name mismatch, or insufficient storage.',
        suggestedChecks: ['adb logcat -d | grep PackageManager'],
      };

    case SIGNAL_CODES.E2E_UIAUTOMATOR_STUCK:
      return {
        strategy: 'retry_candidate',
        maxAttempts: 2,
        requiresHuman: false,
        suggestedAction: 'Kill stuck UI Automator or adb child processes on the device.',
        suggestedChecks: ['adb shell pkill -f uiautomator'],
      };

    case SIGNAL_CODES.E2E_SYSTEM_UI_INTERFERENCE:
      return {
        strategy: 'retry_candidate',
        maxAttempts: 2,
        requiresHuman: false,
        suggestedAction: 'Collapse the status bar or dismiss system dialogs (e.g., ANR, Battery warning).',
        suggestedChecks: ['adb shell cmd statusbar collapse'],
      };

    default:
      return {
        strategy: 'stop',
        maxAttempts: 0,
        requiresHuman: true,
        suggestedAction: 'Review the error logs and determine the manual fix.',
        suggestedChecks: [],
      };
  }
}
