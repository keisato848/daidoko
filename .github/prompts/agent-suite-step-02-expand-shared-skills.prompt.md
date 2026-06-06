---
name: Agent Suite Step 02 - Expand Shared Skills
description: "Extend the shared Agent Suite skills without widening the always-on prompt."
argument-hint: "Optional skill name or workflow to improve"
agent: "agent"
---

Use [the current implementation status](../../docs/agent-suite-implementation-status.md) as the baseline for this step.

Focus only on step 02: expand or refine the shared skills under [`.github/skills/`](../skills/).

Task:
- Improve one or more of [changed-slice-verify](../skills/changed-slice-verify/SKILL.md), [android-release-loop](../skills/android-release-loop/SKILL.md), [e2e-triage](../skills/e2e-triage/SKILL.md), or [scaffold-feature](../skills/scaffold-feature/SKILL.md).
- Keep each skill discovery-friendly and scoped to a repeatable workflow.
- Add referenced helper assets only when the workflow truly needs them.
- Update [the status document](../../docs/agent-suite-implementation-status.md) if step 02 materially changes.

Validation:
- Run `pnpm agent:customizations:test`.
- Run `node scripts/agent/validate-changed-slice.mjs --files .github/skills/<skill>/SKILL.md scripts/agent/test-customizations.mjs docs/agent-suite-implementation-status.md`.

Output:
- The updated skill behavior.
- The validations run.
- Any follow-up work that belongs in scripts instead of SKILL.md.