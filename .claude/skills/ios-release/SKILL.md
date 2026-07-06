---
name: ios-release
description: iOS（App Store）リリース一式（macOS で実行）。Xcode/シミュレータのセットアップ → シミュレータでの動作確認 → iOS用スクショ取得 → EAS iOS ビルド → TestFlight → App Store Connect 提出。方針=無料・広告なし・非取引者。
---

# iOS（App Store）リリースパイプライン（macOS 専用）

このスキルは **Mac 上の Claude / 開発者** 向け。Windows 環境では iOS シミュレータ・Xcode が使えないため、
iOS 固有の作業（シミュレータ動作確認・iOS スクショ・ローカル iOS ビルド）はすべて Mac 側で行う。
背景と全体像は `docs/リリース手順.md` §7、機能パリティ・方針は `docs/フリーミアム設計.md`。

**方針（確定 2026-07-06）**: iOS 初回は **無料・広告なし・非取引者(non-trader)**。
iOS の AI は「無料枠1日1回 ＋ BYOK」。広告/課金の導線は iOS では非表示。

## 0. 前提（初回のみ・ユーザー作業）

- **Apple Developer Program 登録**（年 $99）。App Store Connect でアプリ枠を作成（bundle id `com.daidoko.app`）。
- Mac に **Xcode**（＋Command Line Tools）、**CocoaPods**、**Node/pnpm**、**EAS CLI**（`npm i -g eas-cli`）。
- リポジトリを clone し、**リポジトリルートで** `pnpm install`（`.npmrc` が `node-linker=hoisted`。
  `apps/mobile` 内では実行しない）。

## 1. シミュレータで動作確認（Windows で未確認の iOS 描画をここで検証）

```bash
xcrun simctl boot "iPhone 16 Pro Max" ; open -a Simulator
pnpm --filter mobile exec expo run:ios          # dev クライアントで起動
```

確認ポイント（iOS で有効化した機能）:

- **写真からレシピ**（AI）が表示・動作する（サーバー/BYOK 経由）。端末内ラベリングは iOS では効かないが
  サーバー推論にフォールバックする。
- **文字入り画像OCR / レシート** の入口が **表示されない**（add / 在庫画面。Android 専用のため iOS で非表示）。
- ローカル機能（レシピ/買い物/在庫/調理記録/家族）・バーコード・URL/手動/テキストが動作する。

## 2. App Store 用スクリーンショット（自動取得）

```bash
# ストアショット用ビルド（サンプルデータ有効＋コーチマーク無効）をシミュレータへ
EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 \
  pnpm --filter mobile exec expo run:ios --configuration Release
node scripts/release/capture-ios-screenshots.mjs     # 9:41・満充電に固定して取得
```

- 出力 = `docs/store/app-store/phone-screenshots/`（順序・サイズは同 README）。
- 主サイズ = 6.9"（iPhone 16 Pro Max = 1320×2868）。`08`/`10` は manual（既存維持）。
- **ストア公開物なのでユーザーに提示して承認を得る**。アップロードは App Store Connect Web UI か fastlane deliver
  （Play のような API 一括スクリプトは未整備）。

## 3. EAS iOS 本番ビルド（クラウド・Mac のローカルビルド不要）

```bash
git checkout main && git pull            # EAS はローカル作業ディレクトリをアップロードするため main を使う
cd apps/mobile
pnpm exec eas build -p ios --profile production --non-interactive --no-wait
pnpm exec eas build:view <BUILD_ID> --json   # status FINISHED / artifacts
```

- 初回は EAS が Apple ログインを求め、**配布証明書・プロビジョニングプロファイルを自動生成・管理**する。
- `eas.json` の `build.production` は platform 共有（top-level の env/autoIncrement）なので **iOS ビルドにそのまま使える**。
  CLI 提出する場合のみ `submit.production.ios`（appleId / ascAppId / appleTeamId）を追加。`appVersionSource: local`
  なので app.json の `version` を上げる。
- `ITSAppUsesNonExemptEncryption: false` は設定済み（輸出コンプライアンス質問を回避）。

## 4. TestFlight → 提出（外向きアクション — ユーザー承認を確認）

1. `pnpm exec eas submit -p ios --profile production --latest`（または App Store Connect にアップロード）。
2. **TestFlight** で実機インストールし、写真レシピ・ローカル機能を最終確認。
3. App Store Connect でメタデータを設定:
   - **App Privacy（栄養ラベル）**: AI 機能利用時に写真・食材名をサーバー送信する旨を申告（Play のデータセーフティ相当）。
     端末内 OCR は無効化済みなので申告不要。
   - **DSA 取引者ステータス = 非取引者**（無料・広告なし）。将来広告を入れる場合は取引者だが Apple は個人でも
     **P.O. Box 可**（自宅住所は不要）。
   - スクショ（§2）・説明文（`docs/store/` を iOS 向けに流用）・年齢レーティング・カテゴリ（フード＆ドリンク）。
4. 審査提出（~1〜3日）。

## 既知の注意

- **広告 SDK**: iOS は広告なしだが `react-native-google-mobile-ads` の iosAppId はテスト ID のまま同梱される。
  App Privacy を簡素化したいなら iOS 向けに ads プラグインを app.config.js の条件分岐で除外する検討余地あり。
- **スクショの iOS サイズ**は Android と別物（6.9"）。`docs/store/app-store/` に iOS 専用で保管し、Play の
  `docs/store/google-play/` とは混ぜない。
- iOS のローカル release ビルドは Android の `build-android.mjs` のような特別扱いは不要（`expo run:ios` / EAS で足りる）。
