---
name: Agent Suite Step 06 - Android Failure Signals
description: "Implement structured Android failure signals and recovery rules for the Agent Suite automation loop."
argument-hint: "Optional signal family such as adb, UI dump, Gradle, or signing"
agent: "agent"
---

Use [the current implementation status](../../docs/agent-suite-implementation-status.md) as the baseline for this step.

Focus only on step 06: add structured Android failure signals, recovery rules, and reporting in the scripts under [`scripts/agent/`](../../scripts/agent/) and the existing release/E2E workflow.

Task:
- Formalize failure signal names and map them to retryable vs stop conditions.
- Keep the logic grounded in [docs/デプロイ手順.md](../../docs/デプロイ手順.md) and the existing `e2e/*.mjs` scripts.
- Preserve local app data and existing release verification flows.
- Update [the status document](../../docs/agent-suite-implementation-status.md) if signal coverage changes.

Validation:
- Run the narrowest updated script directly.
- Run `pnpm agent:preflight`.
- Run `node scripts/agent/validate-changed-slice.mjs --files scripts/agent/<changed-files> docs/agent-suite-implementation-status.md`.

Output:
- The new or updated failure signal implementation.
- The validations run.
- Any remaining device-bound checks that still need a real emulator or physical device.