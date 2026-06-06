---
name: Agent Suite Step 07 - Update Docs And Status
description: "Update the Agent Suite documentation, implementation status, and operator-facing guidance."
argument-hint: "Optional document or gap to focus on"
agent: "agent"
---

Use [the current implementation status](../../docs/agent-suite-implementation-status.md) as the baseline for this step.

Focus only on step 07: improve the documentation layer for the Agent Suite.

Task:
- Update [the status document](../../docs/agent-suite-implementation-status.md) with the latest completion state.
- Add or refine supporting docs in `docs/` when the workflow, validation, or rollout semantics changed.
- Keep the documentation explicit about what is done, what is partial, and what is still blocked.

Validation:
- Run `pnpm exec prettier --check docs/agent-suite-implementation-status.md <other-changed-docs>`.
- Run `pnpm agent:customizations:test` if prompt files or `.github/` docs move.
- Run `node scripts/agent/validate-changed-slice.mjs --files docs/agent-suite-implementation-status.md <other-changed-docs>`.

Output:
- The updated docs.
- The validations run.
- The exact remaining gaps after the documentation refresh.