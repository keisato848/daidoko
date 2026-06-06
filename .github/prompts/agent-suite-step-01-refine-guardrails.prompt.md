---
name: Agent Suite Step 01 - Refine Guardrails
description: "Refine the repo-wide Agent Suite guardrails and always-on Copilot instructions."
argument-hint: "Optional focus such as architecture, validation, or Android safety"
agent: "agent"
---

Use [the current implementation status](../../docs/agent-suite-implementation-status.md) as the baseline for this step.

Focus only on step 01: refine the shared guardrails in [the Copilot instructions](../copilot-instructions.md).

Task:
- Align the always-on instructions with [CLAUDE.md](../../CLAUDE.md), [品質基準](../../docs/品質基準.md), [アーキテクチャ設計](../../docs/アーキテクチャ設計.md), and [エージェントフック設計](../../docs/エージェントフック設計.md).
- Keep the file minimal and always-on. Move detailed procedure into docs or skills instead of bloating the instructions.
- Update [the status document](../../docs/agent-suite-implementation-status.md) if the completion state or remaining work changes.

Validation:
- Run `pnpm agent:customizations:test`.
- Run `node scripts/agent/validate-changed-slice.mjs --files .github/copilot-instructions.md docs/agent-suite-implementation-status.md`.

Output:
- The updated guardrails.
- The exact validations run.
- Any remaining ambiguity that should stay outside the always-on prompt.