---
name: console-browser-ops
description: Play Console / AdMob / RevenueCat のブラウザ自動化（Claude in Chrome）運用手順。データセーフティ 5ステップ→審査送信、広告申告、AdMob アプリ/ユニット登録、RevenueCat プロジェクト設定、app-ads.txt（GitHub Pages）まで。§7 は流入の数字（ASC ソースタイプ別・Apple Ads CPI・Play 掲載訪問者）の読み取り取得。承認ゲートと代行不可の境界込み。
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

## 7. 流入の数字を取る（読み取りのみ・`docs/growth/流入の記録.md` §4 の 1〜2）

**目的**: 同文書 §3 の閾値判定に要る 2 系統の数字を、画面から読んでリポジトリ外の `analytics/`（gitignore 済み）に置く。
**リモートセッションでは実行不可**（Claude in Chrome の MCP が無い・ストア API も遮断）。ローカルセッションで回す。
**変更操作は一切しない**。Apple Ads の一時停止だけは §1 のとおりユーザー承認後に実行（Basic は自動停止しないため）。

### 7-0. 別端末で回すときの全手順（pull から）

```text
0. Chrome で ASC / Apple Ads Basic / Play Console にログインしタブを開いたままにする（代行不可）
   Claude in Chrome で appstoreconnect.apple.com / app-ads.apple.com / play.google.com を許可
1. git fetch origin && git checkout <ブランチ> && git pull --ff-only
2. mkdir analytics/YYYY-MM-DD        # gitignore 済み
3. Claude Code を同じフォルダで開き:
   /console-browser-ops
   §7「流入の数字を取る」を回して。読み取りのみ。保存先は analytics/YYYY-MM-DD/。ログイン済みタブは開いてある。
4. Claude が §7-2 の 4 画面を撮り、summary.md に数値を表で書く
5. 続けて: summary.md と docs/growth/流入の記録.md を渡して growth-analyst を model: haiku で呼んで。§3 の閾値に当てて。
6. 要約値と判断だけを 流入の記録.md §1-1 / §3 / §6 へ転記 → commit（スクショと summary.md は commit しない）
7. Apple Ads の「請求書」欄にカード取引が出ていたら＝クレジット枯渇。ユーザー承認後にキャンペーンを一時停止（減額ではなく停止）
```

### 7-1. 事前（ユーザー）

- ログインと 2 段階認証は代行不可。ASC・Apple Ads・Play Console に**先にログインしたタブを開いておく**
- ドメイン許可: `appstoreconnect.apple.com` / `app-ads.apple.com` / `play.google.com`（§0）
- `mkdir analytics/YYYY-MM-DD/` を作っておく（スクショと読み取り値の置き場）

### 7-2. 取るもの（4 画面・順不同）

| #   | 画面                                                                                                        | 読む値                                                                                                                               | 使い道                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1   | ASC → App Analytics → だいどこ → 指標 → **「表示回数」を「ソースタイプ別」で表示**（期間: 公開日〜今日）    | App Store 検索 / App Store ブラウズ / App リファラー / Web リファラー / **Apple Ads（キャンペーン別も開く）** の表示・製品ページ閲覧 | 1,700 表示の内訳。「表示→閲覧 2.5%」が検索語（Ads）由来か面由来かを分ける    |
| 2   | 同 → **「コンバージョン率」** と **「初回ダウンロード数」**（同期間・ソースタイプ別）                       | ソース別の閲覧→DL                                                                                                                    | 製品ページが詰まっていないことの再確認                                       |
| 3   | Apple Ads Basic → ダッシュボード → だいどこ                                                                 | 累計支出・インストール数・**平均 CPI**・月予算上限。アカウント設定 → 請求 → 「請求書」欄に**カード取引が出ていないか**               | CPI ¥1,500 超なら継続しない。取引が出ていたらクレジット枯渇 → 一時停止を提案 |
| 4   | Play Console → 統計 → **「ストア掲載情報のパフォーマンス」**（過去 28 日）と **検索キーワード別の表示回数** | 掲載訪問者の 28 日平均（/日）・インストーラー数・キーワード上位                                                                      | 1/日を超えているか（決定変更 B の効果）。7/27 の 152 表示と比較              |

各画面は `wait 3-5s → screenshot` で撮り、`analytics/YYYY-MM-DD/NN-<画面名>.png` に保存。読み取った数値は同ディレクトリの `summary.md` に表で書く（生データは commit しない）。

### 7-3. 分析へ渡す

`summary.md` と `docs/growth/流入の記録.md` を渡して `growth-analyst` を **`model: haiku`** で呼ぶ（同文書 §6 の前提）。
結果の要約値と判断だけを §1-1 / §3 / §6 へ転記する。スクショは commit しない。

### 7-4. 落とし穴（未検証のものは「未検証」と書く）

- ASC の App Analytics は**同意（Analytics のオプトイン）したユーザー分だけ**。実 DL より少なく出る点を注記する
- Apple Ads のプロモーションクレジットは**残高が見えない**（`docs/browser-tasks-apple-ads.md`「アカウント作成後に分かったこと」）。枯渇の判定は「請求書」欄のみ
- Play の「検索キーワード別の表示回数」は表示数が少ないと**表示されない**ことがある（7/27 は 152/28 日で出ていた。未検証）
