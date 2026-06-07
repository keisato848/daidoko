# だいどこ — 家族で育てる、台所のレシピ手帳

## Agent Suite

AI エージェントが安全にコードベースを検証・操作するための基盤です。ガードレール付きの hook、再利用可能な skill / prompt、専用 custom agent、および Android リリース検証スクリプト群で構成されています。

### 初回セットアップ

```bash
pnpm agent:init
```

Git hooks のインストールと VS Code 拡張の推奨設定を行います。

### 日常運用コマンド

| コマンド                                   | 用途                                         |
| ------------------------------------------ | -------------------------------------------- |
| `pnpm agent:preflight`                     | Node / pnpm / Java / ADB 等の環境チェック    |
| `pnpm agent:validate -- --files <file>...` | 変更スライスの Prettier・smoke test 検証     |
| `pnpm agent:customizations:test`           | hooks / skills / prompts / agents の疎通     |
| `pnpm agent:android:device:health`         | Android デバイス接続・起動状態の確認         |
| `pnpm agent:android:signing:check`         | Play Store 署名環境の準備状態チェック        |
| `pnpm agent:android:loop`                  | preflight → build → install → E2E の一括実行 |
| `pnpm agent:triage:e2e`                    | E2E テスト結果 JSON のトリアージ             |

### アーキテクチャ概要

```
.github/
  hooks/agent-suite.json        … エージェントフック定義
  skills/                       … 再利用可能な skill (changed-slice-verify, android-release-loop, e2e-triage, scaffold-feature)
  prompts/                      … Step ごとの実装 prompt
  agents/                       … custom agents (android-verifier, repo-research, release-orchestrator)

scripts/agent/
  preflight.mjs                 … 環境チェック
  validate-changed-slice.mjs    … スライス検証
  test-customizations.mjs       … カスタマイズ疎通テスト
  android-release-loop.mjs      … Android リリースループ
  build-android.mjs             … Android ビルド
  install-apk.mjs               … APK インストール
  check-device-health.mjs       … デバイスヘルスチェック
  check-play-signing.mjs        … Play 署名チェック
  triage-e2e-report.mjs         … E2E トリアージ
  lib/
    android-signals.mjs         … 構造化 failure signal 定義
    android-retry-policy.mjs    … signal → retry 戦略マッピング
    android-recovery-executor.mjs … 安全な自動復旧アクション
```

### Android 検証の安全原則

- **`adb uninstall` を使わない** — アプリデータの保持を優先する。
- **`pm clear` を使わない** — ユーザーデータを消去しない。
- **データ保持を最優先する** — `git reset --hard`、`.cxx` 削除、`adb kill-server` などの破壊的操作は自動化しない。
- 失敗時は signal と retryPolicy の出力を確認し、次の安全な手順だけを提示する。

### よくある運用例

#### 1. 変更スライスの検証

コミット前に、変更したファイルだけを対象に Prettier と smoke test を実行します。

```bash
pnpm agent:validate -- --files src/components/Toast.tsx docs/agent-suite-implementation-status.md
```

#### 2. Android 事前確認

環境要件の充足と、デバイスが正常に接続・起動しているかを確認します。ビルドや E2E を走らせる前に必ず実行してください。

```bash
pnpm agent:preflight
pnpm agent:android:device:health
```

#### 3. Play 配布前チェック

Play Store 向けの署名環境変数（キーストアパス、パスワード等）が設定されているかを確認します。ローカル APK ビルドだけの場合は省略できます。

```bash
pnpm agent:android:signing:check
```

#### 4. Android release loop の実行

preflight → build → install → E2E を順に実行します。失敗時は signal と retryPolicy が JSON で返されるため、次の安全な手順を判断できます。

```bash
pnpm agent:android:loop
# JSON 出力が必要な場合
pnpm agent:android:loop -- --json
# ビルド済み APK で install + E2E だけ実行する場合
pnpm agent:android:loop -- --skip-build
```

#### 5. E2E 結果のトリアージ

既存のテスト結果 JSON を読み取り、失敗テストの分類と次のアクションを提示します。

```bash
pnpm agent:triage:e2e -- --file e2e/android-e2e-result.json
```

> **注意**: すべての運用例はデータ保持・非破壊を前提としています。`adb uninstall`、`pm clear`、`git reset --hard` などの破壊的操作は含まれません。

### 詳細ドキュメント

- 進捗台帳: [`docs/agent-suite-implementation-status.md`](docs/agent-suite-implementation-status.md)
- デプロイ手順: [`docs/デプロイ手順.md`](docs/デプロイ手順.md)
