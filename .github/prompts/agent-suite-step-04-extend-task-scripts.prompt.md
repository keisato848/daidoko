---
name: Agent Suite Step 04 - Extend Task Scripts
description: 'Extend the core Agent Suite task scripts for validation, triage, or scaffolding.'
argument-hint: 'Optional script focus such as changed-slice, preflight, or triage'
agent: 'agent'
---

Use [the current implementation status](../../docs/agent-suite-implementation-status.md) as the baseline for this step.

Focus only on step 04: improve the scripts in [`scripts/agent/`](../../scripts/agent/) and the root `agent:*` entrypoints in [package.json](../../package.json).

Task:

- Improve one focused area: preflight, changed-slice validation, triage, scaffold planning, or script ergonomics.
- Keep scripts cross-platform and Node-based.
- Do not widen this step into custom agents or Android signal design unless the script change directly requires it.
- Update [the status document](../../docs/agent-suite-implementation-status.md) if step 04 moves forward.

Validation:

- Run the script you changed directly.
- Run `node scripts/agent/validate-changed-slice.mjs --files package.json scripts/agent/<changed-files> docs/agent-suite-implementation-status.md`.
- Run `pnpm agent:customizations:test` when touching package scripts or customization-adjacent files.

Output:

- The script changes.
- The exact commands run.
- Any recommended next split for later commits.
