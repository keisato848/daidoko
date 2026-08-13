# App Store 初回審査提出 — 進捗と残作業

対象: iOS 1.7.0 / build 10019 ／ App ID **6800964382** ／ bundle `com.daidoko.app`
Team: **VY7SNHS2BY**（Kei Sato, Individual）

このファイルは**作業の引き継ぎ用**。Mac 側でこのブランチを clone/checkout して再開する。
背景と手順の全体像は `docs/リリース手順.md` §7 と `.claude/skills/ios-release`。

---

## 済んでいること（2026-08-13・Windows 側で完了）

| 項目                       | 状態                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| Apple Developer Program    | 有効（Team `VY7SNHS2BY`）                                                 |
| 署名クレデンシャル         | 配布証明書・Provisioning Profile とも **2027-08-13 まで有効**（EAS 保管） |
| App Store Connect アプリ枠 | 作成済み（App ID `6800964382`・SKU `daidoko`・プライマリ言語 日本語）     |
| EAS iOS 本番ビルド         | 成功（build `567e0560-d356-422d-a5f9-72d26a21f76c`）                      |
| **TestFlight**             | **1.7.0(1) 配信済み・実機で動作確認済み**（内部グループ「身内テスト」）   |
| 配信地域                   | 175 → **147**（EU27＋英国を除外。新地域の自動追加もオフ）                 |
| App Privacy（栄養ラベル）  | **申告・公開済み**                                                        |
| プライバシーポリシー URL   | 設定済み（gist）                                                          |
| 提出用 API キー            | `eas.json` の `submit.production.ios` に配線済み（`.p8` は `C:\secure\`） |

**提出コマンドは非対話で通る状態**:

```bash
cd apps/mobile
pnpm exec eas submit -p ios --profile production --id <BUILD_ID> --non-interactive
```

---

## 残作業

### 1. スクリーンショット（**macOS 必須**）

主サイズ = 6.9インチ（iPhone 16 Pro Max = 1320×2868）。構成・順序は
`phone-screenshots/README.md` の表（Google Play 版と揃える。iOS では OCR 系の `05` を使わない）。

```bash
# 前提: リポジトリルートで pnpm install（apps/mobile 内では実行しない）
xcrun simctl boot "iPhone 16 Pro Max" ; open -a Simulator

# ストアショット用ビルド（サンプルデータ有効＋コーチマーク無効）
EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 \
  pnpm --filter mobile exec expo run:ios --configuration Release

# 取得（ステータスバーは 9:41・満充電に固定される）
node scripts/release/capture-ios-screenshots.mjs
```

- 出力 = `phone-screenshots/`。**ストア公開物なのでユーザーに提示して承認を得る。**
- **アップロードは ASC API でできる**（`appScreenshotSets` → `appScreenshots` の予約＋アップロード＋コミット。
  疎通確認済み）。Play の `update-play-screenshots.mjs` 相当のスクリプトは未作成なので、
  撮り終えたら Windows 側でも書ける。Web UI から手で上げてもよい。

### 2. 掲載文の反映（Windows でも可）

`listing-ja.md` の内容を `appStoreVersionLocalizations` / `appInfoLocalizations` に流す。
**公開文面なので、反映前に必ずユーザーに提示して承認を得る。**

- **App 名の変更が必要**: アプリ枠は旧 ASO 名で作ってしまっている
  （現行「だいどこ - レシピ管理・買い物リスト・食材管理」→ Play と揃えて
  「だいどこ - お店の味を再現するレシピ・買い物リスト」へ）
- サブタイトル・プロモーションテキスト・キーワード・説明・新機能・サポート URL・著作権

### 3. カテゴリ・年齢制限（Console UI／一部 API）

- プライマリ = フード＆ドリンク、セカンダリ = ライフスタイル
- **年齢レーティングの質問票**は要確認事項あり:
  **Web 共有（レシピを限定公開リンクにする機能）を「ユーザー生成コンテンツ」として申告すべきか。**
  アプリ内に他人の投稿を見る導線は無く、リンクを知る人だけが読める形なので「該当なし」と考えているが、
  Apple の質問文を実際に読んでから判断すること。Play のデータセーフティ側は
  「その他のユーザー作成コンテンツを収集」として申告済み。

### 4. App Review 情報

- **アカウント不要**（デモアカウントの提供は不要）。ログインは存在しない
- 備考に書くべきこと:
  - AI 機能（写真からレシピ／感想での調整／相談）は**ネットワーク接続が必要**
  - AI の無料枠は**インストールごとに1回**。使い切った後はリワード広告を1本見るたびに1回使える
  - 自分の Gemini API キーを設定すると無制限（設定 → 自分の AI キーを使う）
  - **アレルゲン検出は行っていない**（説明文にも明記）

### 5. 提出

上記が揃ってから審査提出。**外向きアクションなのでユーザーの明示承認を得てから。**

---

## 注意（実際に踏んだもの）

- **`eas submit` は「Something went wrong」と出しながら実際は成功していることがある。**
  失敗と決めつけて再実行すると、2回目がビルド番号重複で本当に落ちる。
  **必ず TestFlight 画面（`/apps/6800964382/testflight/ios`）で実物を確認する。**
  詳細ログは CLI に出ない → `expo.dev/.../submissions/<id>` の「Upload to App Store Connect」を展開する
- **`ios.buildNumber` は `app.json` で versionCode と同値に揃えてある。**
  同じ `version` で作り直して再提出するときは buildNumber だけさらに上げる
- App Store Connect の Web UI は**ウィンドウ幅が狭いとサイドバーが畳まれて操作しづらい**。
  ASC API で済むものは API で（アプリ枠作成と App Privacy だけが API 非対応）
