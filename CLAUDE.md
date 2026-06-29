# だいどこ — CLAUDE.md

> Claude Code が毎回読むプロジェクト憲法。実装前に必ずこのファイル全体を読むこと。

---

## 1. プロダクト概要

**アプリ名:** だいどこ（臺所）  
**コンセプト:** 深夜の私設レシピ蔵書庫 — 家族で育てる、台所のレシピ手帳  
**プラットフォーム:** iOS / Android（React Native + Expo）、将来的に Web  
**ステージ:** 設計完了・実装開始前

---

## 2. 設計書インデックス（実装前に必ず参照）

| ファイル                         | 内容                                                  | 実装時の参照タイミング    |
| -------------------------------- | ----------------------------------------------------- | ------------------------- |
| `docs/要件定義.md`               | 機能要件・非機能要件・ユーザーストーリー              | 機能実装前                |
| `docs/データ設計.md`             | 全 17 エンティティの ER 図・型定義・FTS5 設計         | DB スキーマ・クエリ実装前 |
| `docs/画面設計.md`               | 全画面の UI 仕様・コンポーネント対応表                | 画面実装前                |
| `docs/アーキテクチャ設計.md`     | 技術スタック・同期設計・API エンドポイント一覧        | 構成変更・新機能追加前    |
| `docs/レシピ作成フロー.md`       | URL取り込み・OCR・手動入力のロジック詳細              | A1/A2/A4/A5 実装前        |
| `docs/フリーミアム設計.md`       | AI写真レシピの無料枠・課金(RevenueCat)・ゲート設計    | 課金/写真レシピ変更前     |
| `docs/マルチエージェント設計.md` | A1〜A8 エージェントの責務・インターフェース           | 各エージェント実装前      |
| `docs/エージェントフック設計.md` | AgentBridge・Hook システム・ログファイル設計          | Bridge 実装前             |
| `docs/品質基準.md`               | テストカバレッジ閾値・CI ゲート・パフォーマンス目標値 | PR 作成前に必ず確認       |
| `docs/brand/ロゴ仕様.md`         | カラー・フォント・ロゴ使用ルール                      | UI 実装時                 |
| `mockup/app-mockup.jsx`          | インタラクティブモックアップ（React JSX）             | 画面実装の参考            |

---

## 3. 技術スタック

### モノレポ構成

```
daidoko/
├── apps/
│   ├── mobile/          # Expo SDK 54 + Expo Router v6
│   └── server/          # Hono + Node.js 20 + PostgreSQL 16
└── packages/
    └── shared/          # 共通型・Zod スキーマ・定数
```

パッケージマネージャー: **pnpm** (`pnpm-workspace.yaml` 参照)

### Mobile（apps/mobile）

| 役割             | ライブラリ                          |
| ---------------- | ----------------------------------- |
| フレームワーク   | Expo SDK 54                         |
| ナビゲーション   | Expo Router v6（ファイルベース）    |
| ローカル DB      | expo-sqlite + Drizzle ORM           |
| サーバー状態     | TanStack Query v5                   |
| クライアント状態 | Zustand                             |
| フォーム         | React Hook Form + Zod               |
| カメラ / OCR     | react-native-vision-camera + ML Kit |
| アニメーション   | Reanimated 3                        |
| アイコン         | Lucide React Native                 |

### Server（apps/server）

| 役割           | ライブラリ                                    |
| -------------- | --------------------------------------------- |
| フレームワーク | Hono v4                                       |
| ランタイム     | Node.js 20 LTS                                |
| DB             | PostgreSQL 16 + Drizzle ORM                   |
| 認証           | JWT（jose）RS256、リフレッシュトークン Rotate |
| ログ           | pino + pino-roll（日次ローテーション）        |
| テスト         | Vitest + Supertest                            |

### 共通（packages/shared）

- Zod スキーマ（API リクエスト/レスポンス型）
- エージェント共通型（`AgentResult<T>`、`RecipeDraft` 等）
- AgentBridge・HookLogger

---

## 4. ブランドルール（UI 実装時に厳守）

| 用途                         | 表記               | フォント                    |
| ---------------------------- | ------------------ | --------------------------- |
| ロゴ・アイコン・スプラッシュ | **臺所**（正字体） | Shippori Mincho / Yu Mincho |
| アプリ内 UI テキスト全般     | **DAIDOKO**        | Cormorant Garamond Italic   |
| マーケティング・ストア説明   | **だいどこ**       | —                           |

カラーパレット:

```
背景:         #0A0805
ゴールド（主）: #C9A16A
テキスト:      #DCC9A8
罫線:         #2E2418
```

---

## 5. 開発ルール

### コード品質（`docs/品質基準.md` §2 参照）

- TypeScript `strict: true` 必須。`any` 禁止。
- ESLint エラー 0・Prettier 差分 0 でなければ PR 不可。
- テストカバレッジ: サービス層 ≥80%、ユーティリティ ≥90%、UI ≥60%。

### セキュリティ（`docs/品質基準.md` §1 参照）

- GitHub Security の Critical/High アラートはゼロトレランス（1件でも CI ブロック）。
- SQL は必ず Drizzle ORM または `sql` タグテンプレート経由。文字列結合 SQL 禁止。
- JWT は RS256（非対称鍵）のみ。HS256 禁止。

### エージェント実装ルール（`docs/マルチエージェント設計.md` 参照）

- エージェント間の呼び出しは必ず `AgentBridge.call()` 経由。直接インスタンスを呼ばない。
- 各エージェントは `before*/after*` フックを発火させる（`docs/エージェントフック設計.md` 参照）。
- エラー型は `AgentErrorCode` の共通コードを使用する。

### Git ルール

- ブランチ: `develop` ベース。機能ブランチは `feat/xxx`、修正は `fix/xxx`。
- コミットメッセージ: Conventional Commits（`feat:`, `fix:`, `test:`, `docs:`, `chore:`）。
- `main` への直接 push 禁止。PR 経由のみ。
- **マージ前に必ずエミュレーター/実機で動作確認する**（PreToolUse フック `hook-pretool-guard.mjs` が `gh pr merge` / `git merge` を検知して確認を促す）。

---

## 6. よく使うコマンド

```bash
# 開発環境起動
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL + MinIO
pnpm dev:mobile                                   # Expo 起動
pnpm dev:server                                   # Hono サーバー起動

# DB
pnpm --filter server db:generate   # Drizzle マイグレーションファイル生成
pnpm --filter server db:migrate    # マイグレーション適用
pnpm --filter server db:studio     # Drizzle Studio（GUI）

# 品質チェック
pnpm typecheck                     # 全パッケージ型チェック
pnpm lint                          # 全パッケージ ESLint
pnpm format:check                  # Prettier チェック
pnpm test                          # 全パッケージテスト
```

---

## 7. 実装フェーズ

| フェーズ               | 内容                                                | 目安  |
| ---------------------- | --------------------------------------------------- | ----- |
| **v0.1 Alpha（現在）** | ホーム・蔵書・レシピ詳細の UI（ローカル固定データ） | 2 週  |
| v0.5 Beta              | 全画面 + SQLite DB 接続 + 料理中モード              | 6 週  |
| v1.0                   | URL 取り込み + 「作った！」記録 + 家族共有          | 10 週 |
| v1.5                   | OCR + ギャラリー + カレンダービュー                 | 14 週 |
| v2.0                   | クラウド同期 + Web 版                               | TBD   |

---

## 8. v0.1 Alpha の定義（最初のセッションのスコープ）

以下のみを実装する。それ以外は実装しない。

### 対象画面（`docs/画面設計.md` 参照）

- S01: ホーム画面（家族の最新調理カード・作りたいリスト・月の統計）
- S04: レシピ一覧画面（検索 + フィルタタブ。食材名検索対応）
- S05: レシピ詳細画面（材料・手順・調理記録ボタン）
- S06: 料理中モード（全画面ステップ表示・スワイプ操作）

### データ

- SQLite ローカル DB（Drizzle ORM）
- シードデータ 6 件のレシピ（`mockup/app-mockup.jsx` の RECIPES を流用）
- サーバー通信なし（ローカルのみ）

### AgentBridge

- `AgentBridge` と `HookLogger` の基盤実装（A1〜A8 は stub でよい）
- フックは全発火。ログファイル書き込みを動作確認する

### 非対象（v0.1 では実装しない）

- URL 取り込み・OCR・サーバー同期・家族招待・認証

---

## 9. パフォーマンス目標（`docs/品質基準.md` §3 参照）

- コールドスタート: < 3.0 秒（iPhone SE 第3世代 / Pixel 6a 基準）
- レシピ一覧 300 件表示: < 500 ms
- FTS 検索: < 200 ms
- JS フレームレート（スクロール中）: ≥ 55 fps
