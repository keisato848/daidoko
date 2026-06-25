// TEST-ONLY config plugin — DO NOT COMMIT / DO NOT SHIP.
// Enables cleartext (plaintext HTTP) traffic so a release/preview build can
// reach a local dev server (http://localhost:3000 via `adb reverse`) on a real
// device. Production talks to Railway over HTTPS and must NOT allow cleartext.
const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withCleartextDev(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:usesCleartextTraffic'] = 'true';
    return cfg;
  });
};
