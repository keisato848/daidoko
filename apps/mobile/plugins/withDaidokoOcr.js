const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

// Android-only config plugin for だいどこ.
//
// History: this plugin previously also scaffolded a native ML Kit OCR module
// (DaidokoOcrModule) plus a Play upload-signing gate injected into
// build.gradle. Both were removed during the Expo SDK 54 upgrade:
//   - The OCR native module was never actually registered (its MainApplication
//     anchor referenced a package that no longer exists), so it was dead code.
//     ML Kit's bundled .so files also predate Android's 16 KB page-size
//     requirement and would have re-introduced the Play 16 KB rejection.
//   - Release signing is handled by EAS-managed credentials; the local
//     keystore was lost and the gradle gate keyed on a `getRNVersion()` anchor
//     that SDK 54's template no longer emits, leaving build.gradle broken.
//
// What remains is the part that still matters for Google Play compliance:
// blocking the broad media/storage permissions that expo-file-system's plugin
// would otherwise request (Photo and Video Permissions policy), and ensuring
// the CAMERA permission used by the in-app photo capture flow is declared.

function ensureManifestPermission(manifest, permissionName) {
  const usesPermission = manifest['uses-permission'] ?? [];
  if (!usesPermission.some((permission) => permission.$?.['android:name'] === permissionName)) {
    usesPermission.push({ $: { 'android:name': permissionName } });
  }
  manifest['uses-permission'] = usesPermission;
}

function withDaidokoCameraPermission(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    ensureManifestPermission(configWithManifest.modResults.manifest, 'android.permission.CAMERA');
    return configWithManifest;
  });
}

// expo-file-system's config plugin unconditionally requests broad media-library
// access, but this app only reads/writes its own app-private documentDirectory,
// which never requires these permissions. Block them to satisfy Google Play's
// Photo and Video Permissions policy.
function withDaidokoBlockedStoragePermissions(config) {
  return AndroidConfig.Permissions.withBlockedPermissions(config, [
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.READ_MEDIA_IMAGES',
  ]);
}

module.exports = function withDaidokoOcr(config) {
  config = withDaidokoCameraPermission(config);
  config = withDaidokoBlockedStoragePermissions(config);
  return config;
};
