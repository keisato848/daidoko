---
name: Agent Suite Step 05 - Add Custom Agents
description: "Add the next focused custom agent for Agent Suite workflows such as repo research or Android verification."
argument-hint: "Optional custom agent role to implement"
agent: "agent"
---

Use [the current implementation status](../../docs/agent-suite-implementation-status.md) as the baseline for this step.

Focus only on step 05: add one minimal custom agent under [`.github/agents/`](../agents/).

Task:
- Implement one tightly scoped agent such as repo-research, android-verifier, or release-orchestrator.
- Give it a narrow role, the minimum tools, and clear boundaries.
- Avoid circular handoffs and avoid duplicating skill content verbatim.
- Update [the status document](../../docs/agent-suite-implementation-status.md) to reflect new coverage.

Validation:
- Run `pnpm agent:customizations:test`.
- Run `node scripts/agent/validate-changed-slice.mjs --files .github/agents/<agent>.agent.md scripts/agent/test-customizations.mjs docs/agent-suite-implementation-status.md`.

Output:
- The custom agent file.
- The validations run.
- Any follow-up integration needed with skills or hooks.