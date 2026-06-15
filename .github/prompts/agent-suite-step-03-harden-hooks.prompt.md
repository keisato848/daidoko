---
name: Agent Suite Step 03 - Harden Hooks
description: 'Improve the Agent Suite workspace hooks and their runtime guard behavior.'
argument-hint: 'Optional hook event or guardrail to target'
agent: 'agent'
---

Use [the current implementation status](../../docs/agent-suite-implementation-status.md) as the baseline for this step.

Focus only on step 03: harden the hook layer in [`.github/hooks/agent-suite.json`](../hooks/agent-suite.json) and the matching scripts in [`scripts/agent/`](../../scripts/agent/).

Task:

- Improve `SessionStart`, `PreToolUse`, or `PostToolUse` behavior without adding long-running or opaque hook logic.
- Keep guardrails aligned with local-data retention and the no-destructive-command policy.
- Prefer deterministic checks and compact `systemMessage` output.
- Update [the status document](../../docs/agent-suite-implementation-status.md) if hook coverage or remaining gaps change.

Validation:

- Run `pnpm agent:customizations:test`.
- Run `node scripts/agent/validate-changed-slice.mjs --files .github/hooks/agent-suite.json scripts/agent/hook-session-start.mjs scripts/agent/hook-pretool-guard.mjs scripts/agent/hook-posttool-validate.mjs docs/agent-suite-implementation-status.md`.

Output:

- The hook changes.
- The validations run.
- Any remaining fixture tests that should be added next.
