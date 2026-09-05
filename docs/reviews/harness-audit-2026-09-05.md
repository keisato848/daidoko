<!-- 生成: harness-audit Skill（Harness 7 軸。IpaLab の harness-auditor v2.0 を移植した初回実行）
     問い: 2026-09-05 に見直したエージェントスイート（束ねる役 4 + 専門役 7 の新設、2 体の整理）は Harness として足りているか
     実行: 2026-09-05 / 対象 = PR #284 の head（claude/agent-suite-review-wpohi5）/ 機械検査 test-customizations OK・--self-test 14/14 OK -->

# Harness Audit Report: daidoko エージェントスイート（2026-09-05）

## サマリー

- **総合スコア**: **18/21**
- **成熟度**: **Advanced**（全軸 2 以上・3 が 4 軸。Expert まで 1 点）
- **対象**: `CLAUDE.md` §5 / `docs/開発ハーネス.md` §2・§7 / `.claude/settings.json` / `scripts/agent/lib/agent-router.mjs` / `scripts/agent/test-customizations.mjs` / `.claude/workflows/*.js` / `.claude/agents/*.md`（25 体。うち 11 体を全軸採点）
- **機械検査**: `node scripts/agent/test-customizations.mjs` → OK / `node scripts/agent/hook-user-prompt-router.mjs --self-test` → 14/14 OK
- **総評（事実）**: ルーティングは 3 層（description → `CLAUDE.md` §5 表 → `ROUTES`）で同期しており、束ねる役 4 体の `Agent(...)` 許可リストは §7-5 の表と 1 体の差も無い。ガードレールは事故日付つきで根拠が残っている。弱いのは「読むだけの役に書けるツールが残っている」「検証結果が会話にしか残らない」「検証器が CI に無く、`tools:` を見ていない」の 3 点。

## 軸別スコア

| #   | 軸                  | スコア | 主な根拠（事実）                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tool Coverage       |      2 | ✅ 全 11 体の description に起動フレーズ。✅ WHEN/DO は `CLAUDE.md` §5 表 + `agent-router.mjs` + `settings.json`。✅ MCP 名は全て実在。❌ 「PR 前」の起動条件が diff-critic / test-writer / quality-manager の 3 つに重複。❌ `ROUTES` の `/品質/` `/スコープ/` が広く誤爆（「品質基準の文書を読んで」→ QM）。❌ `store-ops` は編集を謳うが Edit/Write 無し |
| 2   | Context Efficiency  |      3 | 11 体とも 49〜77 行。参照は「§番号＋いつ読むか」付き。毎ターン読まれるのは `CLAUDE.md` のみ                                                                                                                                                                                                                                                                 |
| 3   | Quality Gates       |      3 | フック 5 種＋ pre-commit 4 段＋ CI 6 ゲート。QM「test-writer に書かせ緑を確認してから再判定」、test-writer の変異検証、server-verifier の `FAILED → logs`                                                                                                                                                                                                   |
| 4   | Memory Persistence  |      3 | 学びの書き出しは 4 層で強制（§5 表 → finding-recorder → Stop 督促 → SessionStart 索引）。Gotchas は日付・版・Issue 番号つき。❌ コンパクション耐性は部分的: 11 体中ファイルに残すのは 4 体のみ                                                                                                                                                              |
| 5   | Eval Coverage       |      2 | ✅ 判定語の強制（go/no-go・severity）、workflow は JSON schema で縛る。❌ `test-customizations.mjs` は `name`/`description` の有無しか見ない（`tools:` の名前解決は未検証）。❌ 同スクリプトは pre-commit のみで CI に無い。❌ `--self-test` は手動のみ                                                                                                     |
| 6   | Security Guardrails |      3 | 11 体すべてに「禁止事項」節。外向きアクションは司令塔＋承認に固定。PreToolUse 23 ルール、書き込み内容のシークレット deny、`railway variables --json` 強制。❌ 例外 1 件: `issue-groomer` が `mcp__github__issue_write` を持つ                                                                                                                               |
| 7   | Cost Efficiency     |      2 | ✅ 本文は固有情報のみ、既定値が明示、router は無音・最大 2 役。❌ 11 体すべて `model:` 未指定（PjM は毎セッション起動）。❌ Bash が不要に見える体が 2（PM・app-leader）。❌ 同じ表が 3 か所                                                                                                                                                                 |

## 改善提案（優先度順）と対応

| 重大度 | 軸                  | 問題（事実）                                                                                                                                                               | 提案                                                                                                                | 対応（2026-09-05）                                                                                                                                     |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🔴 高  | Security Guardrails | `issue-groomer` が `mcp__github__issue_write` を持つ。本文は「クローズしない・既定は提案まで」、§7-4 は「読むだけの役」に分類。書けるツールを持つ読み取り役はこの 1 体だけ | `issue_write` を外し、ラベル適用は司令塔が行う                                                                      | **ユーザー判断で不採用**（2026-09-05）。MCP の書き込みツールを持つこと自体は OK。ラベルは指示があった Issue だけ・クローズは提案まで、を禁止事項で縛る |
| 🟡 中  | Eval Coverage       | 検証器が CI に無い（`test-customizations.mjs` は pre-commit のみ、`--self-test` は未配線）                                                                                 | `ci.yml` に 2 step 追加                                                                                             | **済**。Quality Gates に Q-7 / Q-8 として追加                                                                                                          |
| 🟡 中  | Eval Coverage       | `test-customizations.mjs` が `tools:` を解析しない。`Agent(...)` 内の名前・`mcp__*` の実在は人手                                                                           | `Agent(...)` の各名が `.claude/agents/<name>.md` か組み込み名であること、`tools` の各項目が既知の名であることを検査 | **済**。`validateClaudeAssets` に追加                                                                                                                  |
| 🟡 中  | Memory Persistence  | PR 前パイプラインの成果物（QM の判定・diff-critic の block）が会話にしか無い                                                                                               | 判定を PR コメントか `docs/reviews/` に残す規約                                                                     | **済**。QM の出力を司令塔が PR コメントに貼る規約を §7-3 と QM 手順に追加                                                                              |
| 🟡 中  | Memory Persistence  | `knowledge-map.mjs` の `KNOWLEDGE_TARGETS`（4 種）と `record-finding` の決定表（7 行）がずれ、SessionStart 索引に出ない種類がある                                          | `KNOWLEDGE_TARGETS` を決定表と揃える                                                                                | **済**。実在ファイルのみで 7 行に                                                                                                                      |
| 🟡 中  | Tool Coverage       | `store-ops` は本文で編集を謳うが `Edit`/`Write` が無い                                                                                                                     | 本文を直すか、`Edit` を足して `docs/store/**` に限定                                                                | **済**。`Edit` を足し、編集先を `docs/store/**` に限定する禁止事項を追加                                                                               |
| 🟡 中  | Security Guardrails | `test-writer` / `finding-recorder` のパス制限は散文のみ。フックはパスも呼び出し元エージェントも見ない（推測: ペイロードにエージェント識別子が無い）                        | QM の手順に「test-writer 後に `__tests__`/`__mocks__`/`test-support` 以外が変わっていないか」を足す                 | **済**                                                                                                                                                 |
| 🟢 低  | Tool Coverage       | 起動条件の重複（diff-critic / test-writer / QM が全て「PR 前」）。issue-groomer と PjM の起動場面が同じ。QM の description に eval-inference が無い                        | description に前後関係を入れる                                                                                      | **済**                                                                                                                                                 |
| 🟢 低  | Tool Coverage       | `ROUTES` の `/品質/` `/スコープ/` が語単体で当たる。「PR のレビューをして」は無音                                                                                          | 狭める・広げる、self-test に 4 文追加                                                                               | **済**                                                                                                                                                 |
| 🟢 低  | Cost Efficiency     | PM・app-leader の `Bash` の用途が本文に無い                                                                                                                                | 用途を 1 行書くか外す                                                                                               | **済**。用途（`gh` / `git log`）を 1 行明記                                                                                                            |
| 🟢 低  | Cost Efficiency     | 11 体すべて `model:` 未指定。毎セッション起動の PjM は軽量モデルで足りる可能性（推測）                                                                                     | `project-manager` に `model: sonnet` を付けて数セッション比較                                                       | **方針変更**（同日）。ユーザー指示で全役に `model:` を明示。判断・執筆・作業の役は `fable`、audit/persona は `sonnet`。PjM の sonnet 試行は取り下げ    |
| 🟢 低  | Cost Efficiency     | 記録先の決定表が 3 か所、Issue 規約が 2 か所に複製                                                                                                                         | エージェント側は節参照 1 行に置換                                                                                   | **済**。finding-recorder / issue-groomer の複製を参照に置換                                                                                            |

## エージェント別スコア（T/C/Q/M/E/S/$ ＝ 合計。修正前）

| エージェント            | 行数 | スコア                 | 最重要の改善 1 つ                                                                                                      |
| ----------------------- | ---: | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `product-manager`       |   67 | 2/3/2/1/1/3/2 = **14** | 日付つき実例が 0。判断を誤った/覆した実例を「前提」節として 2〜3 件足す（**未対応**: 実例は今後の運用から採る）        |
| `quality-manager`       |   70 | 3/3/3/2/2/3/3 = **19** | 判定と根拠をファイル（PR コメント）に残す                                                                              |
| `project-manager`       |   72 | 3/3/2/2/2/3/2 = **17** | 毎セッション起動なのに主モデル。`model: sonnet` を試す。B の観点は `release-readiness.js` と二重（自認済み）           |
| `app-leader`            |   71 | 2/3/3/2/2/3/2 = **17** | 計画がファイルに残らない。`scripts/agent/scaffold-feature-plan.mjs` の流用可否を確認（**未対応**: 次の機能着手で試す） |
| `diff-critic`           |   77 | 2/3/3/2/2/3/3 = **18** | block 一覧を PR コメントに残す（QM 経由で対応）                                                                        |
| `test-writer`           |   68 | 2/3/3/3/3/2/3 = **19** | パス制限が散文のみ → QM の diff 検査で担保                                                                             |
| `finding-recorder`      |   64 | 3/2/2/3/2/3/2 = **17** | `knowledge-map.mjs` と決定表のずれを揃える。決定表の複製を参照に                                                       |
| `server-verifier`       |   69 | 3/3/3/3/2/3/3 = **20** | 判定表をファイルに残す以外に欠点が見当たらない。「前提」8 件はスイートで最も具体的な Gotchas                           |
| `release-notes-drafter` |   49 | 3/3/2/3/2/3/3 = **19** | 「利用者が気づくか」の選別に検証手段が無い。persona 1 名に読ませる 1 手順（**未対応**: 効果未計測のため見送り）        |
| `issue-groomer`         |   64 | 2/2/2/2/2/2/3 = **15** | `mcp__github__issue_write` を外す（🔴）                                                                                |
| `eval-inference`        |   64 | 3/3/3/3/3/3/3 = **21** | 本監査の観点では欠点なし                                                                                               |

平均 17.8。最低は `product-manager`（Gotchas 無し）と `issue-groomer`（書けるツール）。

## 重複・ツール最小性の所見（audit-\* / persona-\* / 作業役）

- `audit-*`×6: 全て `Read, Grep, Glob` + `model: sonnet`。description は対象物で分離され相互重複なし。`audit-listing-claims` は 153 行でスイート最長
- `persona-*`×5: 全て `Read, Glob` + `model: sonnet`。proactive 起動条件を持たず、`persona-review.js` から名指しでのみ呼ばれる設計。重複リスク無し
- `android-verifier`: `PowerShell` は adb `/sdcard` ルールで正当化される。`ios-release-mac`: `Bash` のみで本文は全て CLI。過不足なし
- 起動語の交差: 「掲載文」は `ROUTES` で `product-manager` に流れ、`store-ops`（実務）と `release-notes-drafter`（波及の指摘）は `ROUTES` に無い。作業役は束ねる役経由という §7-5 の設計と整合

**推測（未確認）**: 束ねる役の `Agent(...)` 構文がランタイムで許可リストとして機能しているかは本監査では確認していない。機能していない場合、§7-5「ネストは 2 段まで・束ねる役どうしは呼ばない」は散文だけの規約になる。次のセッションで束ねる役を初めて呼ぶときに確かめる。

## 完了条件との照合

- 全 7 軸にスコアと根拠あり。🔴 1 件は同日に修正。機械検証 2 本は成功し、同日に CI へ配線。
- 修正後の再採点は次のスイート変更時に行う（同一セッションでは新しい定義が読み込まれないため）。
