---
name: harness-audit
description: エージェントスイート（.claude/agents・skills・workflows・フック・CLAUDE.md の委譲表）を Harness 7 軸フレームワーク（Tool Coverage / Context Efficiency / Quality Gates / Memory Persistence / Eval Coverage / Security Guardrails / Cost Efficiency、各 0〜3 点・21 点満点）で監査し、優先度付きの改善提案を出す。エージェントを足した・直した後、スイート見直しの前後、「このエージェント構成で足りてる？」と聞かれたときに使う。
---

# Harness 7 軸監査

> 出典: `keisato848/IpaLab` の `.github/skills/harness-auditor`（v2.0・Copilot 向け）。
> このスキルはそれを Claude Code の語彙へ写したもの。**基準（7 軸・0〜3 点・成熟度）は変えていない。**
> 用語の対応は下表。両方を育てると必ずずれるので、基準を変えるときは IpaLab 側を正として先に直す。

| IpaLab（Copilot）の語                | daidoko（Claude Code）での実体                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| AGENTS.md の WHEN/DO ルーティング    | `CLAUDE.md` §5「エージェントへの委譲」の表 ＋ `scripts/agent/lib/agent-router.mjs` の `ROUTES` |
| Custom Agents（`.agent.md`）         | `.claude/agents/*.md`（`name` / `description` / `tools` / `model`。束ねる役は `Agent(...)`）   |
| copilot-instructions.md              | `CLAUDE.md` 全体                                                                               |
| hooks（`.github/hooks/*.json`）      | `.claude/settings.json` → `scripts/agent/hook-*.mjs`                                           |
| `mcp-servers` frontmatter            | `tools:` に書く `mcp__github__*` のツール名                                                    |
| `validate-github-customizations.ps1` | `node scripts/agent/test-customizations.mjs`・`hook-user-prompt-router.mjs --self-test`        |
| スイート（AGENTS.md 配下の skills）  | 束ねる役 4 体とその `Agent(...)` 許可リスト（`docs/開発ハーネス.md` §7-5）                     |
| Gotchas セクション                   | 各定義の「実例」「前提」節（日付・版・Issue 番号つきの具体例だけを数える）                     |

## 手順

1. 対象を決める（スイート全体 / 特定の役 / 直近で触った定義）。全体なら `docs/開発ハーネス.md` §1・§7 を先に読む
2. 機械検査を先に通す（構文・frontmatter・振り分け表の歯）:
   `node scripts/agent/test-customizations.mjs && node scripts/agent/hook-user-prompt-router.mjs --self-test`
3. 7 軸それぞれを 0〜3 で採点する（0=未対応 / 1=基本対応 / 2=良好 / 3=優秀）。**根拠に必ずファイル:行を付ける**

### 軸 1: Tool Coverage（ツール網羅性）

- [ ] `description` が「何をするか ＋ いつ呼ぶか」を含み、LLM が委譲を判断できる（人が読んで分かるかではない）
- [ ] 役どうしで `description` のキーワードが被っていない（被ると振り分けが不安定になる）
- [ ] `CLAUDE.md` §5 の委譲表と `ROUTES` が同じ内容で、依頼の型を網羅している
- [ ] 各役の `tools` が仕事に必要な最小（読むだけの役に `Edit` / `Write` が無い、束ねる役の `Agent(...)` が配下だけ）
- [ ] MCP を使う役は `tools:` にツール名を列挙し、ローカル（`gh`）とリモート（MCP）の両方の手が書いてある

### 軸 2: Context Efficiency（コンテキスト効率）

- [ ] 定義本文が 150 行以内（Copilot 基準の 500 行は Claude Code の subagent には長すぎる。長いものは Skill / docs へ分離）
- [ ] 参照文書への言及が「いつ読むか」付き（「〜を参照」だけの丸投げが無い）
- [ ] 全 `description` の合計が 15,000 トークン以内（Claude Code は全 description を常時読み込む）
- [ ] 手順・数値の正典が 1 か所（定義に写した数値が設計書とずれていない）

### 軸 3: Quality Gates（品質ゲート）

- [ ] 出力形式が決まっていて、判定（go/no-go・推奨/見送り）を曖昧にできない
- [ ] 「見つからなければ空で返す」「水増ししない」が書いてある
- [ ] 束ねる役は配下の指摘を自分で裏取りする手順がある（貼るだけにしない）
- [ ] フック（PreToolUse / Stop / UserPromptSubmit）と CI が定義の外側からも守っている

### 軸 4: Memory Persistence（メモリ永続化）

- [ ] 具体的な実例（日付・版・Issue・何が起きたか）が 3 件以上ある。汎用的な注意書きは数えない
- [ ] 分かったことをどこへ書くかが決まっている（`record-finding` の決定表・`finding-recorder`）
- [ ] 長い作業の中間結果をファイルに残す指示がある（コンパクション耐性。`docs/reviews/`・`docs/eval/`）

### 軸 5: Eval Coverage（評価カバレッジ）

- [ ] 出力の合格条件が書いてある（例: 15 行以内、500 字以内、変異で赤くなること）
- [ ] 失敗時の手順がある（前提が無いときに止まる、赤いときに何をするか）
- [ ] 機械検査がある（`test-customizations.mjs`・`--self-test`・CI Q-6）。無いものは「歯が無い」と明記

### 軸 6: Security Guardrails（セキュリティガードレール）

- [ ] 禁止事項が明示されている（編集しない・commit しない・外向きアクションをしない）
- [ ] 外向きアクション（`eas submit` / `railway up` / 掲載公開 / Issue クローズ）が司令塔＋ユーザー承認に留まっている
- [ ] 秘密情報（API キー・サービスアカウント・環境変数の値）を表示・記録しない規則がある
- [ ] git を触る役が同一ワークツリーで並行しない設計になっている（§7-2）

### 軸 7: Cost Efficiency（コスト効率）

- [ ] 本文が簡潔で、エージェントが知らない固有情報だけを書いている（コードを読めば分かることを書かない）
- [ ] 既定が明示され、選択肢が最小（「PR 前は差分に関係する検査役だけ」のような絞り）
- [ ] 軽い仕事の役は `model: sonnet`、判断の重い役だけ既定モデル
- [ ] 毎回走るもの（SessionStart の現状報告・UserPromptSubmit）が短く縛られている

4. 総合スコアと成熟度を出し、改善提案を優先度順に並べる

## 出力テンプレート

```markdown
# Harness Audit Report: <対象>

## サマリー

- **総合スコア**: <合計>/21
- **成熟度**: <Beginner|Intermediate|Advanced|Expert>
- **機械検査**: test-customizations / --self-test の結果

## 軸別スコア

| # | 軸 | スコア | 根拠（ファイル:行） |
| 1 | Tool Coverage | /3 | |
| … | | | |

## 改善提案（優先度順）

| 重大度 | 軸 | 問題 | 提案（ファイルと具体的な修正） |
| 🔴 高 | | | |
| 🟡 中 | | | |
| 🟢 低 | | | |
```

成熟度: Beginner 0–7（または 0 点の軸がある） / Intermediate 8–14（全軸 1 以上） / Advanced 15–18（全軸 2 以上） / Expert 19–21（全軸 2 以上かつ半数が 3）。

レポートは `docs/reviews/harness-audit-<YYYY-MM-DD>.md` に残す（冒頭に「生成 / 問い / 実行」のメタ情報ヘッダ）。
採用した改善は `docs/開発ハーネス.md` §7-4 の改廃記録に理由込みで足す。

## Gotchas

- **スイート全体を見ずに役単体を採点すると Tool Coverage が過大評価される。** 役の description が良くても、
  `CLAUDE.md` §5 の表に無ければ名指しされない限り呼ばれない。表と `ROUTES` と description の三者を突き合わせる
- **Gotchas の「量」で採点しない。** daidoko の定義は「実例」節に日付・版・Issue 番号つきで書く流儀。
  「注意すること」「〜に気をつける」だけの項目は 0 件と数える
- **Copilot 基準の 500 行は Claude Code では長すぎる。** subagent は呼ばれるたびに定義全体を読む。
  150 行を超えたら手順を Skill へ、実例を docs へ逃がす（`android-verifier` の実機規約が境界例）
- **機械検査が緑でも歯が無いことがある。** `test-customizations.mjs` は frontmatter の解析だけ、
  `--self-test` は振り分け表だけを見る。「この定義を空にしても検査が緑か」を自問する
- **MCP の書き込みツールを持つこと自体は減点しない**（2026-09-05 ユーザー判断）。初回監査は `issue-groomer` の
  `issue_write` を 🔴 にしたが不採用になった。見るのは「何を書いてよいかが禁止事項で縛られているか」。
  `Edit` / `Write` を読むだけの役が持つのは引き続き減点
- **同一セッションでは新しい定義が読み込まれない。** 監査で直した定義の効きは次のセッションで確かめる

## 検証ループ

1. レポートを生成する
2. 確認: 全 7 軸にスコアと根拠（ファイル:行）があるか / 改善提案がファイルと修正内容まで書けているか /
   成熟度が基準と整合しているか / 🔴 の指摘が「型・lint・テストでは捕まらないもの」に絞れているか
3. 不整合があれば直して再生成する
4. 整合した状態で `docs/reviews/` に保存し、🔴 を Issue か同ブランチの修正にする
