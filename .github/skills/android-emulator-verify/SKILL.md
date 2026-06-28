---
name: android-emulator-verify
description: 'Use when verifying the app on an Android emulator or device through adb and uiautomator — layout checks, measuring element bounds, or driving the UI — especially when screenshots are unavailable or capped.'
user-invocable: true
argument-hint: 'Provide the emulator/device serial and the screen or flow to verify'
---

# Android Emulator / Device Verification (adb + uiautomator)

## When To Use

- Confirming UI and layout on phone and tablet form factors.
- Measuring element heights/widths or asserting a control fits (e.g. a CTA label).
- Driving a flow when image viewing is rate-limited and you must rely on the view tree.

## Procedure

1. **adb on Windows**: `/c/Users/<user>/AppData/Local/Android/Sdk/platform-tools/adb.exe`.
   Export `ANDROID_SDK_ROOT` before launching AVDs, or boot panics with "Cannot find AVD system path".
2. **Local server from device**: `adb reverse tcp:3000 tcp:3000` (re-apply after reconnect).
3. **Dump the view tree**: `adb shell uiautomator dump /sdcard/u.xml` then
   `MSYS_NO_PATHCONV=1 adb pull /sdcard/u.xml C:/tmp/u.xml`. Without `MSYS_NO_PATHCONV=1`,
   Git Bash mangles the `/sdcard/...` path and you silently pull a **stale local file**.
   Parse `bounds="[x1,y1][x2,y2]"` for measurements; decode as UTF-8 for Japanese text.
4. **Dismiss the soft keyboard safely**: first check
   `adb shell dumpsys input_method | grep mInputShown`. Press BACK
   (`adb shell input keyevent 4`) **only when `mInputShown=true`** — it then hides the
   keyboard and does NOT pop the screen. **Never press BACK with the keyboard down** — it
   pops the form and loses entered input.
5. **Tap at rest**: coordinate taps must use the keyboard-down (rest) layout; with the
   keyboard up, dumped coordinates no longer match on-screen positions. Confirm the right
   field focused by dumping and checking `focused="true"` before typing.
6. **Known caveat**: software-GPU emulators **drop adb input-injection events under load** —
   typed text may not land even into a focused field. Use the emulator for layout/rendering;
   verify input-driven flows (forms, purchases) on real hardware.

## Constraints

- Non-destructive / read-only. Do not `adb uninstall` or `pm clear` without explicit authorization.
- Do not trust a single dump after an action on a slow emulator — re-dump and confirm state changed.
