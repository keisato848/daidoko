# Daidoko Project Guidelines

Use this file as the always-on workspace guide for GitHub Copilot in this repository.

## Read Before Large Changes

- [CLAUDE.md](../CLAUDE.md) — product constitution, brand, tech stack, dev rules.
- [docs/品質基準.md](../docs/%E5%93%81%E8%B3%AA%E5%9F%BA%E6%BA%96.md) — quality gates, test coverage thresholds, CI merge-block conditions, trace IDs.
- [docs/アーキテクチャ設計.md](../docs/%E3%82%A2%E3%83%BC%E3%82%AD%E3%83%86%E3%82%AF%E3%83%81%E3%83%A3%E8%A8%AD%E8%A8%88.md) — stack, service boundaries, AI usage policy.
- [docs/エージェントフック設計.md](../docs/%E3%82%A8%E3%83%BC%E3%82%B8%E3%82%A7%E3%83%B3%E3%83%88%E3%83%95%E3%83%83%E3%82%AF%E8%A8%AD%E8%A8%88.md) — AgentBridge, HookLogger, hook safety rules.
- [docs/デプロイ手順.md](../docs/%E3%83%87%E3%83%97%E3%83%AD%E3%82%A4%E6%89%8B%E9%A0%86.md) — Android release, ADB, Play work.

## Architecture

- Monorepo: `apps/mobile`, `apps/server`, `packages/shared`. Package manager is **pnpm**.
- **Local-first.** No server OCR, server image analysis, or server AI fallback for sync on-device flows.
- Agent calls via `AgentBridge.register()` / `AgentBridge.call()` only. No direct cross-agent invocation.
- Hook logging via `HookLogger`. Do not bypass lifecycle hooks for new agent flows.

## Safety

- TypeScript `strict: true`. No `any`.
- ESLint errors and Prettier diffs must be zero.
- SQL via Drizzle ORM or shared helpers only. No string concatenation.
- Auth stays RS256. No HS256.
- Never commit secrets, keystores, tokens, or credentials.
- Preserve Android local data — no `adb uninstall` / `pm clear` unless explicitly requested.
- No destructive git commands (`git reset --hard`, `git checkout --`) unless explicitly requested.
- Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`. Branch from `develop`.

## Validation

- After code edits, run the nearest local validation before replying.
- `pnpm agent:validate -- --files <paths...>` for changed-slice checks.
- `pnpm agent:preflight` before environment-sensitive work.
- `pnpm agent:customizations:test` when `.github`, `.githooks`, `scripts/agent`, or root config changes.
- If `packages/shared` changes, also validate downstream mobile and server type safety.
- Self-repair on validation failure up to three loops, then ask the user.

## Android And E2E

- `pnpm agent:android:loop` for build-install-E2E orchestration.
- `pnpm agent:triage:e2e` for failure triage.
- Treat ADB, Gradle `.cxx`, and signing issues as environment failures first, not product bugs.

## Editing Style

- Keep changes minimal and local.
- Prefer existing root scripts over ad-hoc shell sequences.
- Update docs when behavior or workflow changes.
