---
name: emulator-verify
description: Android エミュレータ/実機での画面・機能検証の定型。AVD 準備（DNS・wipe）、検証用ビルド（サンプルデータ/コーチマーク無効/無料枠調整）、ディープリンク遷移、スクショ確認、ローカルサーバー E2E、テスト写真の投入まで。ML Kit・広告などネット必須機能の落とし穴込み。
---

# Android エミュレータ/実機 検証の定型

実機操作の細則は `.claude/agents/android-verifier.md`、リリース検証は `release-play` / `release-verify` Skill。

## 1. エミュレータ準備

```powershell
# AVD 一覧 / 起動（検証は 1080x2400 の daidoko_e2e_fresh_api36 が基準。x86_64 なので --arch x86_64 でビルド）
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -list-avds
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd daidoko_e2e_fresh_api36 -no-boot-anim -no-audio -no-snapshot -dns-server 8.8.8.8,1.1.1.1
```

- **`-dns-server 8.8.8.8,1.1.1.1` を必ず付ける**（エミュレータ DNS 死亡の実績。広告/UMP/ML Kit モデル DL はネット必須）
- **疎通判定に ping は使えない**（emulator NAT は ICMP 不可）— `dumpsys connectivity` の `IS_VALIDATED` を見る
- クリーン状態が要る検証（初回フロー・シード確認）だけ `-wipe-data`。wipe 直後は SystemUI ANR が出やすい
  （dumpsys で `Application Not Responding` を検出 → 画面 x30%/y57% の「Wait」をタップ。capture スクリプトは自動処理）
- **ML Kit（OCR/ラベリング）はオフラインでは動かない**（unbundled モデルを Play Services 経由で初回 DL）。
  OCR 検証は実機かオンラインの Google Play イメージで

## 2. 検証用ビルドのフラグ

```bash
# すべて EXPO_PUBLIC_* はビルド時焼き込み。組み合わせて使う
EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1     # サンプルシード（recipe-1〜6・調理記録・家族「恵/健/陽」）
EXPO_PUBLIC_DISABLE_COACH_MARKS=1    # コーチマーク非表示（スクショ・回帰確認用）
EXPO_PUBLIC_FREE_DAILY_LIMIT=0       # 無料枠0=常時ペイウォール（広告フロー E2E 用）
EXPO_PUBLIC_ADMOB_ENABLED=true       # 広告有効（テストIDなら Google テスト広告）
node scripts/agent/build-android.mjs --arch x86_64   # app.json/plugins 変更時は --prebuild 必須
```

インストールは常に `adb install -r`（`-r` なしはローカルデータ消失リスクで hook が ask）。

## 3. 画面遷移・確認

- 遷移は **ディープリンクが最も堅牢**: `adb shell am start -W -a android.intent.action.VIEW -d "daidoko://<route>" com.daidoko.app`
  （route 例: 空=ホーム / recipes / recipes/recipe-1 / recipes/recipe-1/cook / family / recipes/import-photo / settings / pantry / shopping）
- 状態を確定させたいときは事前に `adb shell am force-stop com.daidoko.app`（コールドスタート）
- スクショ: `adb exec-out screencap -p > file.png` → Read で目視。**adb は PowerShell ツールで**（Git Bash は /sdcard を壊す）
- 座標タップは**直前のスクショで座標を確認**（コーチマーク・ANR・通知パネル等のオーバーレイが座標を奪う）

## 4. ローカルサーバー E2E（AI 機能）

```bash
# サーバー起動（.env は自動ロードされない — --env-file 必須）
cd apps/server && pnpm exec tsx --env-file=.env src/index.ts
```

```powershell
adb reverse tcp:3000 tcp:3000        # 端末 localhost:3000 → ホスト（開発検証）
adb reverse --remove-all             # 本番構成検証時は必ず除去（既定 = Railway 本番へ向く）
```

サーバーログの 200 応答で「端末から届いた」ことを裏どりする。

## 5. テスト写真の投入（AI 写真機能の E2E）

ギャラリーに画像が要る場合:

```powershell
adb push test.jpg /sdcard/Pictures/test.jpg
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/test.jpg
```

（画像自体は実写真をコピーするか、System.Drawing 等で生成した「料理らしい」画像。not_a_dish 判定される画像は無料枠を消費しない）

## 既知の落とし穴まとめ

| 症状                         | 原因と対処                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| 広告/UMP/名寄せが失敗        | エミュレータの DNS 死亡 → `-dns-server` 付きで再起動。ping での判定は不可                                 |
| OCR/ラベリングが動かない     | ML Kit モデル未DL（オフライン）→ オンライン実機/Google Playイメージで                                     |
| スクショに ANR ダイアログ    | wipe 直後の SystemUI 高負荷 → Wait をタップ、2〜3分待つ                                                   |
| タップが効かない             | オーバーレイ（コーチマーク等）が手前 → スクショで確認して先に閉じる                                       |
| ネイティブ変更が反映されない | prebuild していない → `--prebuild`（build スクリプトが警告を出す）                                        |
| 署名不一致で install 失敗    | debug/release・EAS 鍵の混在 → 同一署名のビルドで `-r`、やむを得ない時だけユーザー承認の上アンインストール |
