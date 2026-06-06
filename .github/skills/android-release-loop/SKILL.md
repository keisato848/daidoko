---
name: android-release-loop
description: 'Use when building Android release artifacts, installing APKs, running release E2E, checking adb health, or iterating on Gradle and device issues.'
user-invocable: true
argument-hint: 'Provide device serial, arch, and suite if known'
---

# Android Release Loop

## When To Use
- Before Android release verification.
- When iterating on Gradle, adb, OCR, or photo-recipe changes.
- When the agent should build, install, and run release E2E with minimal manual steps.

## Procedure
1. Run `pnpm agent:preflight` to confirm Node, pnpm, Java, adb, and Gradle wrapper availability.
2. Run `pnpm agent:android:loop -- --device <serial> --arch arm64-v8a --suite base` for a standard device release pass.
3. Use `--suite ocr`, `--suite photo`, or `--suite all` when the changed slice touches those flows.
4. Use `pnpm agent:triage:e2e -- --file e2e/android-e2e-result.json` if a suite fails.

## Constraints
- Preserve local app data.
- Do not use `adb uninstall` or `pm clear` unless the user explicitly authorizes data loss.
- Follow `docs/デプロイ手順.md` for Play-specific or signing-sensitive work.