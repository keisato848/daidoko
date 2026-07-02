---
name: expo-monorepo-local-build
description: 'Use when building an Android APK locally in the pnpm monorepo without EAS, or debugging a Gradle build that cannot resolve ./index.js or finds No routes (Metro workspace-root mismatch).'
user-invocable: true
argument-hint: 'Provide target arch (arm64-v8a for device, x86_64 for emulator) and EXPO_PUBLIC_SERVER_URL if known'
---

# Expo Monorepo Local Android Build

## When To Use

- Building a local debug/release APK for a real device or emulator (instead of an EAS cloud build).
- Debugging a Gradle build that fails with `Unable to resolve ./index.js from .../` or `No routes found`.

## Procedure

1. Build via the helper, which already sets the required env:
   - Emulator: `EXPO_PUBLIC_SERVER_URL=http://localhost:3000 node scripts/agent/build-android.mjs --arch x86_64`
   - Device: `EXPO_PUBLIC_SERVER_URL=<url> node scripts/agent/build-android.mjs --arch arm64-v8a`
2. Root cause of entry/routes failures in this monorepo: pnpm hoists deps and Metro's
   inferred **workspace root** differs from the app root, so expo-router cannot find the
   routes or `./index.js`. The durable fix (already in `build-android.mjs` + `package.json`):
   - `EXPO_NO_METRO_WORKSPACE_ROOT=1` and `NODE_ENV=production` in the build env, and
   - `"main": "index.js"` in `apps/mobile/package.json`.
3. Always run `pnpm install` from the **repo root** (root `.npmrc` has `node-linker=hoisted`);
   never `pnpm install` inside `apps/mobile` — it hijacks the workspace.
4. Install the APK: `adb -s <serial> install -r <apk>`. If it fails with a **signature
   mismatch** against an existing EAS-signed build, `adb uninstall com.daidoko.app` first
   (this clears local app data — get authorization).

## Constraints

- Do not reintroduce SDK 51-era pnpm `overrides` or native patches — SDK 54 (RN 0.81) does not need them.
- Prefer **EAS Build** for the production AAB; local Gradle is for device/emulator iteration.
- Treat `adb uninstall` / data loss as authorized-only.
