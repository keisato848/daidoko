# Claude Code — 初回プロンプト

> このファイルは Claude Code の最初のセッションで貼り付けるプロンプトです。
> `C:\Projects\daidoko` ディレクトリで `claude` を起動してから使用してください。

---

## プロンプト本文

```
まず CLAUDE.md を読んでください。その後、以下の作業を行ってください。

---

## 背景

「だいどこ」という家族向けレシピ管理アプリの実装を開始します。
設計書はすべて docs/ に揃っています。モノレポの骨格（package.json・tsconfig 等）も配置済みです。

## 今セッションのゴール：v0.1 Alpha の実装

CLAUDE.md §8「v0.1 Alpha の定義」に従い、以下を実装してください。

### タスク 1：pnpm install と環境確認

1. `pnpm install` を実行して依存関係をインストールする
2. `pnpm typecheck` が通ることを確認する（エラーがあれば修正する）

### タスク 2：AgentBridge 基盤（packages/shared）

`docs/エージェントフック設計.md` を読み、以下を実装してください。

- `packages/shared/src/bridge/types.ts`（HookName・HookContext・AgentResult 型）
- `packages/shared/src/bridge/timestamp.ts`（captureTimestamp・elapsedMs）
- `packages/shared/src/bridge/AgentBridge.ts`（on/off/fire/call/pipe）
- `packages/shared/src/bridge/HookLogger.ts`（registerAll・handle・flush）

各エージェント（A1〜A8）の実装は stub（インターフェースのみ定義、run は未実装）で構いません。

### タスク 3：SQLite スキーマ（apps/mobile）

`docs/データ設計.md` を読み、以下を実装してください。

- `apps/mobile/src/db/schema.ts`：Drizzle ORM で全エンティティを定義する
  - 優先順位：Recipe・RecipeRevision・Ingredient・Step・Tag・RecipeTag・CookingLog
  - FTS5 仮想テーブルも定義する（`docs/エージェントフック設計.md` §5.5 参照）
- `apps/mobile/src/db/migrations/`：`drizzle-kit generate` でマイグレーションファイルを生成する
- `apps/mobile/src/db/seed.ts`：`mockup/app-mockup.jsx` の RECIPES 定数を元に 6 件のシードデータを作成する

### タスク 4：画面実装（apps/mobile）

`docs/画面設計.md` と `mockup/app-mockup.jsx` を参照して、以下の 4 画面を実装してください。

対象画面：
- S01: ホーム（`app/(tabs)/index.tsx`）
- S04: レシピ一覧（`app/(tabs)/recipes/index.tsx`）
- S05: レシピ詳細（`app/(tabs)/recipes/[id].tsx`）
- S06: 料理中モード（`app/(tabs)/recipes/[id]/cook.tsx`）

UI ルール（CLAUDE.md §4 参照）：
- 背景 `#0A0805`、ゴールド `#C9A16A`、テキスト `#DCC9A8`
- アプリ内テキストは DAIDOKO（Cormorant Garamond Italic）
- ヘッダーバーなし。ホーム画面は FAB（φ48px ゴールド、右下）
- レシピ一覧で食材名検索にヒットしたカードはゴールドボーダー＋食材バッジ表示

データは SQLite から取得すること（タスク 3 のスキーマを使用）。

### タスク 5：品質チェック

すべての実装が終わったら：

1. `pnpm typecheck` — エラー 0 を確認
2. `pnpm lint` — エラー 0 を確認
3. `pnpm format:check` — 差分 0 を確認
4. `pnpm test` — テストを実装してすべてパスさせる
   - `packages/shared` の AgentBridge・HookLogger のユニットテスト
   - `apps/mobile` の DB seed・FTS 検索のテスト

---

## 実装方針の補足

- **設計書と実装を常に一致させること**。設計書と異なる判断をした場合は、その理由をコミットメッセージに記載する。
- **スコープを守ること**。v0.1 対象外（URL 取り込み・認証・同期等）は実装しない。
- **型安全を最優先**。`any` は使わない。型が合わない場合は型定義を直す。
- タスク完了のたびに `git add -A && git commit -m "feat: ..."` でコミットする。
```

---

## 使用方法

1. ターミナルで `cd C:\Projects\daidoko` に移動
2. `claude` コマンドを起動
3. 上記プロンプト本文をそのまま貼り付けて送信
