---
name: console-browser-ops
description: Play Console / AdMob / RevenueCat のブラウザ自動化（Claude in Chrome）運用手順。データセーフティ 5ステップ→審査送信、広告申告、AdMob アプリ/ユニット登録、RevenueCat プロジェクト設定、app-ads.txt（GitHub Pages）まで。承認ゲートと代行不可の境界込み。
---

# コンソール類のブラウザ自動化 運用手順

Claude in Chrome（mcp\_\_claude-in-chrome\_\_\*）でメインループが実行する。**サブエージェントには委譲しない**
（store-ops はブラウザ操作を禁止。取得・検証・dry-run 担当）。

## 0. 接続とドメイン許可（毎回の落とし穴）

1. `tabs_context_mcp`（createIfEmpty: true）で接続確認。未接続ならユーザーに拡張機能の確認を依頼
2. **拡張機能の操作許可はドメイン単位**。初回はユーザーに許可を依頼する:
   - Play Console = `play.google.com`
   - AdMob = `admob.google.com`（apps.admob.com からリダイレクトされる点に注意）
   - RevenueCat = `app.revenuecat.com`
3. 許可が切れると navigate が「Navigation to this domain is not allowed」で失敗 → 再許可を依頼
4. SPA は描画待ちが要る（wait 3-5s → screenshot）。CDP screenshot timeout は数秒待って再試行

## 1. 承認ゲートと代行不可の境界（最重要）

| 操作                                                                    | 扱い                                                                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| フォーム入力・設定変更のドラフト                                        | 実行可（内容は都度ユーザーに見せる）                                                      |
| **審査への送信・公開反映**（データセーフティ送信・掲載公開）            | **ユーザー明示承認後のみ**                                                                |
| **法的契約への同意**（販売/配布契約・Payments 規約の「送信」）          | **代行不可 — ユーザーがクリック**                                                         |
| アカウント作成・ログイン・カード/銀行/税務情報の入力                    | **代行不可**                                                                              |
| 秘密鍵ファイルのアップロード（RevenueCat のサービスアカウント JSON 等） | **代行不可**                                                                              |
| **Google Payments 販売アカウントの送信**                                | **方針Aの間は絶対にしない**（送信→課金有効化は自宅住所公開・不可逆。リリース手順 §6-0-a） |

## 2. Play Console: データセーフティ（実績手順 2026-07-05）

1. アプリ → アプリのコンテンツ → データセーフティ（URL 直行可: `.../app-content/data-privacy-security`）
2. 5 ステップウィザード: 概要 → 収集とセキュリティ → データの種類 → 使用と処理 → プレビュー
3. 全タイプ「エフェメラル」だとストア掲載は「データ収集は申告されていません」表示になる（仕様どおり・慌てない）
4. **保存だけでは審査に載らない** — 「公開の概要」→「変更を審査に送信」まで実行（ここがユーザー承認ポイント）
5. 現行申告は docs/リリース手順.md §4 に記録。変更時は同ドキュメントも更新

## 3. Play Console: 広告申告（広告有効化リリース時）

アプリのコンテンツ → 広告 → 「アプリに広告を含める」= はい。データセーフティ側も広告ID/デバイスID を
「収集・共有（広告パートナー）・広告またはマーケティング目的」で申告（§2 の手順で）。
**AAB の AD_ID 権限と申告の不一致は提出拒否**になる（トリプルチェック: app.json blockedPermissions / 広告申告 / データセーフティ）。

## 4. AdMob: アプリ登録・広告ユニット（実績手順 2026-07-06）

1. `admob.google.com/v2/apps/create` → Android → 「ストアに登録済み=はい」→ パッケージ名で検索 → 追加
2. アプリ ID（`ca-app-pub-…~…`）とユニット ID（`ca-app-pub-…/…`）を控えて app.json / eas.json に配線
3. リワードユニット: アプリ → 広告ユニット → リワード（報酬は既定 1/Reward でよい — アプリは視聴完了イベントのみ参照）
4. **app-ads.txt**: `google.com, pub-<ID>, DIRECT, f08c47fec0942fa0` を Play 掲載の連絡先ウェブサイトの
   **ドメイン直下**に設置。だいどこは `keisato848/keisato848.github.io` リポジトリ（GitHub Pages）に設置済み —
   更新は `gh api repos/keisato848/keisato848.github.io/contents/app-ads.txt` の PUT、
   Pages ビルドが `building` のまま固まったら `gh api .../pages/builds -X POST` で再トリガー
5. アプリ確認（要審査）はクロール後最大7日。承認まで実広告は配信制限

## 5. RevenueCat（実績手順 2026-07-06・現在は方針Aで凍結）

- 無料枠 = 月間トラッキング収益 $2,500 まで。サインアップ時のカード登録は「**Add it later / Continue without card**」で不要
- プロジェクト → エンタイトルメントは **`premium`**（コード `PREMIUM_ENTITLEMENT_ID` と一致必須。提案の「〜Pro」等にしない）
- Offering は Monthly のみ（アプリは `monthly` パッケージだけ参照）
- Play Store アプリ設定（package 名）だけで**公開 SDK キーは発行される**（サービスアカウント JSON は購入検証に必要 = ユーザー作業）
- **公開 SDK キーは取得済みでも eas.json に入れない**（edit-guard が ask で止める。リリース手順 §6-0-a）

## 6. その他の実績 Tips

- 掲載のテキスト/スクショ反映は**ブラウザ不要**（`scripts/release/update-play-*.mjs` = androidpublisher API）。
  ブラウザは「API 非対応の申告系」だけに使う
- Play の連絡先ウェブサイト変更も API 可: edits/details PATCH の `contactWebsite`
- Google 系 API の fetch が `UND_ERR_CONNECT_TIMEOUT` で落ちることがある → 単純リトライで通る
