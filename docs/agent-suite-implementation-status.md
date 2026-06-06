# Agent Suite 実装進捗

更新日: 2026-06-06

## 目的

このドキュメントは、だいどこの Agent Suite 基盤整備について、現時点でどこまで完了しているかをリポジトリ内で明示するための進捗台帳です。チャット履歴に依存せず、次回セッションで現在地を再開できることを目的とします。

## 現在の基準コミット

- Foundation 実装コミット: `ceae66a` `feat: add agent suite automation foundation`

## 進捗サマリー

| Step | 内容                                                | 状態        | 現在の成果物                                                                                                      | 残作業                                                          |
| ---- | --------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 01   | 常時 system prompt とガードレール固定               | Done        | `.github/copilot-instructions.md`                                                                                 | docs 側の更新に追随する運用を残す                               |
| 02   | repo-shared skills と workspace hooks の追加        | Done        | `.github/skills/*`, `.github/hooks/agent-suite.json`                                                              | skill 説明の精緻化、将来の custom agent 追加                    |
| 03   | Agent 用の core task scripts 整備                   | In progress | `scripts/agent/preflight.mjs`, `validate-changed-slice.mjs`, `triage-e2e-report.mjs`, `scaffold-feature-plan.mjs` | fixture tests、play-signing check、device-health 専用スクリプト |
| 04   | git hooks / VS Code tasks / shared entrypoints 整備 | In progress | `.githooks/*`, `.vscode/tasks.json`, `.vscode/extensions.json`, `package.json` scripts                            | 実運用での hook install、有効化確認、運用ガイドの追記           |
| 05   | custom agents の追加                                | Not started | なし                                                                                                              | repo-research / android-verifier / release-orchestrator の実装  |
| 06   | Android failure signal と自動復旧の強化             | In progress | Android build/install/loop の土台、E2E triage                                                                     | `NO_AUTHORIZED_DEVICE` などの構造化 signal 定義と retry policy  |
| 07   | ドキュメントと step prompt 群の整備                 | In progress | この進捗ドキュメント                                                                                              | `.github/prompts/` の整備、README への導線追加                  |
| 08   | rollout と本番運用への有効化                        | Not started | なし                                                                                                              | `pnpm agent:init` 実行、real-device loop、運用観測              |

## 現時点で実装済みの主な資産

### Shared instructions / skills / hooks

- `.github/copilot-instructions.md`
- `.github/hooks/agent-suite.json`
- `.github/skills/changed-slice-verify/SKILL.md`
- `.github/skills/android-release-loop/SKILL.md`
- `.github/skills/e2e-triage/SKILL.md`
- `.github/skills/scaffold-feature/SKILL.md`

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

1. `scripts/agent/test-customizations.mjs` に prompt / custom agent / hook fixture の検証を広げる。
2. `validate-changed-slice.mjs` の mobile / server テスト選別をもっと細かくする。
3. Android loop に device health と failure signal を明示的に組み込む。

### Priority B

1. `.github/prompts/` を追加し、各実装ステップを再利用可能 prompt に落とす。
2. `pnpm agent:init` と `docs/デプロイ手順.md` の導線を README に追加する。
3. custom agents を最小構成で追加する。

## 次に進める順序

1. step prompt 群を追加する。
2. prompt / prompt links を customization smoke test に含める。
3. そのまとまりを独立コミットする。
4. その後で Android failure signal と custom agents に進む。
