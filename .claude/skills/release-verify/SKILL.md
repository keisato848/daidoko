---
name: release-verify
description: リリース前の成果物検証チェック集。AAB の 16KB ELF アライメント（scripts/release/check-elf-align.py）、AndroidManifest の権限監査（AD_ID 等）、アップグレードインストール検証（既存データ維持）、config plugin 注入のサイレント no-op 確認。
---

# リリース前 成果物検証

`release-play`（提出フロー）から呼ばれる検証の詳細。**バリデーション拒否では versionCode は未消費**
（同じ番号で再提出できる）ので、拒否を恐れず提出前にここで潰す。

## 1. 16KB ELF アライメント（Android 15+ 必須）

```bash
python scripts/release/check-elf-align.py <app-release.aab|apk|dir>
# arm64-v8a / x86_64 の全 .so で PT_LOAD p_align >= 0x4000 = PASS（1.3.0 実績: 42/42）
```

**内部テストでは検出されず、製品版昇格時に初めて拒否される**（10004 で実発生）— 必ず提出前にローカル検証。

## 2. AndroidManifest 権限監査（特に AD_ID）

```bash
# AAB から manifest を確認（bundletool or aapt2。単純確認なら unzip + strings でも可）
unzip -p <aab> base/manifest/AndroidManifest.xml | strings | grep -i permission
```

- **広告なしリリース**: `com.google.android.gms.permission.AD_ID` が**無い**こと（app.json blockedPermissions が効いているか）
- **広告ありリリース**: AD_ID が**有る**こと＋Play の広告申告・データセーフティと一致（不一致は提出拒否の実績）
- `ACCESS_ADSERVICES_*` 系は SDK 由来で無害（申告不要）

## 3. アップグレードインストール検証（既存ユーザー保護）

新バージョンを「クリーンインストール」だけで検証しない。**旧バージョン→新バージョンの上書き**で:

```powershell
# 旧版がインストール済みの端末/エミュレータに
adb install -r <new.apk>   # -r 必須（データ維持）
```

- 既存の SQLite データ（レシピ・調理記録・在庫）が残り、マイグレーション（migrate.ts の ALTER）が正常に走ること
- 署名が一致していること（EAS 鍵 76:BA:… ↔ ローカル release 鍵は別物。混在時は install が失敗する）

## 4. config plugin 注入の確認（サイレント no-op 対策）

Expo config plugin のネイティブ注入は**アンカー文字列の不一致で黙って no-op になる**
（OCR が EAS ビルド 4 世代連続で壊れていた実績）。plugins/ を変更したリリースでは:

1. クリーン prebuild: `pnpm --filter mobile exec expo prebuild --platform android --clean`
   （またはビルドスクリプトの `--prebuild`）
2. 注入結果を grep で確認:
   ```bash
   grep -rn "DaidokoOcr" apps/mobile/android/app/src/main/java/ | head
   grep -n "daidokoOcr\|packageList" apps/mobile/android/app/src/main/java/com/daidoko/app/MainApplication.kt
   ```
3. そのビルドを実機/エミュレータで起動し、該当 NativeModule が `NativeModules.<name>` に到達することを確認

## 5. リリースノート（提出前に起草）

Play の「このリリースの新機能」ja-JP を起草してユーザー承認を得る（500字以内・ユーザー向けの言葉で）。
