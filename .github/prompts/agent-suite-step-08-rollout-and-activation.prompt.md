---
name: Agent Suite Step 08 - Rollout And Activation
description: "Activate and verify the Agent Suite in the local workspace without widening scope into unrelated feature work."
argument-hint: "Optional activation scope such as git hooks, init flow, or rollout checklist"
agent: "agent"
---

Use [the current implementation status](../../docs/agent-suite-implementation-status.md) as the baseline for this step.

Focus only on step 08: activate the Agent Suite for real use in the current workspace.

Task:
- Run the local activation flow such as `pnpm agent:init` or the narrower subset that applies.
- Verify that hook installation, shared scripts, and prompt discovery are usable in this workspace.
- Document any activation-only issues back into [the status document](../../docs/agent-suite-implementation-status.md).
- Do not widen this step into new feature implementation.

Validation:
- Run `pnpm agent:preflight`.
- Run `pnpm agent:customizations:test`.
- Run the specific activation command you changed or executed.

Output:
- Activation result.
- What is now live in the workspace.
- Any remaining manual steps that the operator still must perform.