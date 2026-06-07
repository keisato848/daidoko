# Agent Suite 実装進捗

更新日: 2026-06-06 (Step 01 guardrails aligned)

## 目的

このドキュメントは、だいどこの Agent Suite 基盤整備について、現時点でどこまで完了しているかをリポジトリ内で明示するための進捗台帳です。チャット履歴に依存せず、次回セッションで現在地を再開できることを目的とします。

## Foundation Baseline (初期の基準コミット)

- `ceae66a` `feat: add agent suite automation foundation` — scripts, hooks, skills, entrypoints
- `7c265e7` `docs: add agent suite implementation status` — この進捗台帳
- `593fdc3` `docs: add agent suite progress prompts` — `.github/prompts/agent-suite-step-*.prompt.md`

上記 3 コミットで、Agent Suite の初期基盤を再現できる。

## 進捗サマリー

| Step | 内容                                                | 状態        | 現在の成果物                                                                                                                                 | 残作業                                                                                                        |
| ---- | --------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 01   | 常時 system prompt とガードレール固定               | Done        | `.github/copilot-instructions.md`                                                                                                            | docs 更新時に追随する運用のみ（CLAUDE.md / 品質基準 / アーキテクチャ設計 / エージェントフック設計と整合済み） |
| 02   | repo-shared skills と workspace hooks の追加        | Done        | `.github/skills/*`, `.github/hooks/agent-suite.json`                                                                                         | skill 説明の精緻化、将来の custom agent 追加                                                                  |
| 03   | Agent 用の core task scripts 整備                   | Done        | `scripts/agent/preflight.mjs`, `validate-changed-slice.mjs`, `triage-e2e-report.mjs`, `scaffold-feature-plan.mjs`, `check-device-health.mjs` | なし（slice-test 精緻化・signing/healthチェック完了）                                                         |
| 04   | git hooks / VS Code tasks / shared entrypoints 整備 | In progress | `.githooks/*`, `.vscode/tasks.json`, `.vscode/extensions.json`, `package.json` scripts                                                       | 実運用での hook install、有効化確認、運用ガイドの追記                                                         |
| 05   | custom agents の追加                                | Not started | なし                                                                                                                                         | repo-research / android-verifier / release-orchestrator の実装                                                |
| 06   | Android failure signal と自動復旧の強化             | Done        | Android build/install/loop の土台、E2E triage、failure signals / retry policy / recovery executor                                            | なし（構造化 signal・ポリシー・リカバリ実装完了）                                                             |
| 07   | ドキュメントと step prompt 群の整備                 | In progress | この進捗ドキュメント、`.github/prompts/agent-suite-step-*.prompt.md`                                                                         | README への導線追加、運用例の補強                                                                             |
| 08   | rollout と本番運用への有効化                        | Not started | なし                                                                                                                                         | `pnpm agent:init` 実行、real-device loop、運用観測                                                            |

## 現時点で実装済みの主な資産

### Shared instructions / skills / hooks

- `.github/copilot-instructions.md`
- `.github/hooks/agent-suite.json`
- `.github/skills/changed-slice-verify/SKILL.md`
- `.github/skills/android-release-loop/SKILL.md`
- `.github/skills/e2e-triage/SKILL.md`
- `.github/skills/scaffold-feature/SKILL.md`
- `.github/prompts/agent-suite-step-*.prompt.md`

### Agent scripts

- `scripts/agent/preflight.mjs`
- `scripts/agent/validate-changed-slice.mjs`
- `scripts/agent/test-customizations.mjs`
- `scripts/agent/triage-e2e-report.mjs`
- `scripts/agent/build-android.mjs`
- `scripts/agent/install-apk.mjs`
- `scripts/agent/android-release-loop.mjs`
- `scripts/agent/hook-session-start.mjs`
- `scripts/agent/hook-pretool-guard.mjs`
- `scripts/agent/hook-posttool-validate.mjs`
- `scripts/agent/install-git-hooks.mjs`
- `scripts/agent/scaffold-feature-plan.mjs`

### Shared entrypoints

- `package.json` の `agent:*` scripts
- `.githooks/pre-commit`
- `.githooks/pre-push`
- `.vscode/tasks.json`
- `.vscode/extensions.json`

## 実行確認済みコマンド

- `node scripts/agent/preflight.mjs`
- `node scripts/agent/test-customizations.mjs`
- `node scripts/agent/validate-changed-slice.mjs --files package.json scripts/agent/validate-changed-slice.mjs scripts/agent/test-customizations.mjs .github/copilot-instructions.md`
- `node scripts/agent/triage-e2e-report.mjs e2e/android-e2e-result.json`
- `node scripts/agent/scaffold-feature-plan.mjs --name "agent suite" --surfaces mobile,shared,docs`

## 未完了の焦点

### Priority A

1. custom agents を最小構成で追加する（Step 05）。

### Priority B

1. `pnpm agent:init` と `docs/デプロイ手順.md` の導線を README に追加する。
2. custom agents を最小構成で追加する（Step 05）。

### 完了済み（参考）

- ~~`.github/prompts/` を追加し、各実装ステップを再利用可能 prompt に落とす。~~ → `593fdc3` で完了。
- ~~prompt / prompt links を customization smoke test に含める。~~ → `test-customizations.mjs` が prompt を検証済み。
- ~~`test-customizations.mjs` に prompt / custom agent / hook fixture の検証を広げる。~~ → prompt・hook は検証済み。agent は Step 05 で追加後に対応。
- ~~`validate-changed-slice.mjs` の mobile / server テスト選別をもっと細かくする。~~ → ディレクトリ粒度のターゲット実行に精緻化済み。

## 次に進める順序

1. custom agents を最小構成で追加する（Step 05）。
2. README への導線追加と運用ガイド補強（Step 07）。
