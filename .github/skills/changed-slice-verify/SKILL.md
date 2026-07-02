---
name: changed-slice-verify
description: 'Use when validating recent code edits, checking only the touched slice, or deciding which lint, typecheck, test, and E2E commands to run before replying.'
user-invocable: true
argument-hint: 'Pass changed files or tell the agent to inspect the current diff'
---

# Changed Slice Verify

## When To Use

- After editing code and before replying to the user.
- When you need a smaller alternative to full-repo validation.
- When root config, hooks, skills, or package scripts changed.

## Procedure

1. Run `pnpm agent:validate -- --files <path1> <path2>` when the touched files are known.
2. Use `pnpm agent:validate -- --staged` before commit boundaries.
3. If the validator emits Android or E2E recommendations, run the recommended command only when the changed slice actually touches that surface.
4. If validation fails, repair the same slice first and rerun the same command.

## Outputs

- Executed validation tasks
- Failed tasks with tail output
- Recommendations for heavier follow-up checks
