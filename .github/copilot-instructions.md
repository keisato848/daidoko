# Daidoko Project Guidelines

Use this file as the always-on workspace guide for GitHub Copilot in this repository.

## Read Before Large Changes

- Use [CLAUDE.md](../CLAUDE.md) as the product constitution.
- Use [docs/品質基準.md](../docs/%E5%93%81%E8%B3%AA%E5%9F%BA%E6%BA%96.md) for quality gates and trace IDs.
- Use [docs/アーキテクチャ設計.md](../docs/%E3%82%A2%E3%83%BC%E3%82%AD%E3%83%86%E3%82%AF%E3%83%81%E3%83%A3%E8%A8%AD%E8%A8%88.md) for stack and service boundaries.
- Use [docs/エージェントフック設計.md](../docs/%E3%82%A8%E3%83%BC%E3%82%B8%E3%82%A7%E3%83%B3%E3%83%88%E3%83%95%E3%83%83%E3%82%AF%E8%A8%AD%E8%A8%88.md) for AgentBridge and HookLogger behavior.
- Use [docs/デプロイ手順.md](../docs/%E3%83%87%E3%83%97%E3%83%AD%E3%82%A4%E6%89%8B%E9%A0%86.md) before Android release, ADB, or Play work.

## Architecture

- The monorepo has three primary surfaces: `apps/mobile`, `apps/server`, and `packages/shared`.
- Agent code must use `AgentBridge.register()` and `AgentBridge.call()` rather than direct cross-agent invocation.
- Hook logging must stay compatible with `HookLogger`; do not bypass lifecycle hooks for new agent flows.
- Keep the product local-first. Do not add server OCR, server image analysis, or server AI fallback for the mobile OCR and photo-recipe flows unless the user explicitly changes the architecture.

## Safety And Data Retention

- TypeScript stays strict. Do not introduce `any`.
- Database access must use Drizzle ORM or the shared SQL helpers. Do not concatenate SQL strings.
- Authentication must stay on RS256. Do not switch to HS256.
- Never print or commit secrets, keystores, tokens, passwords, or upload credentials.
- For Android verification, preserve local data. Do not run `adb uninstall`, `pm clear`, or other destructive app-reset commands unless the user explicitly asks for data loss.
- Avoid destructive git commands such as `git reset --hard` and `git checkout --` unless explicitly requested.

## Validation Expectations

- Before replying after code edits, run the nearest validation you can execute locally.
- Prefer `pnpm agent:validate -- --files <paths...>` for changed-slice validation.
- Use `pnpm agent:preflight` before environment-sensitive work.
- If validation fails and the failure is local to your change, attempt self-repair before asking the user. Stop after three repair loops for the same slice.
- If `packages/shared` changes, also validate downstream type safety for mobile and server.
- If `.github`, `.githooks`, `scripts/agent`, or root config files change, run `pnpm agent:customizations:test`.

## Android And E2E Work

- Use `pnpm agent:android:loop` for build-install-E2E orchestration when possible.
- Use the release E2E scripts in `e2e/` and triage failures with `pnpm agent:triage:e2e`.
- Treat ADB, UIAutomator, Gradle `.cxx`, and signing issues as recoverable environment failures first, not product bugs.

## Editing Style

- Keep changes minimal and local.
- Prefer root scripts over ad-hoc shell sequences when a project script already exists.
- Update documentation when behavior or workflow changes.
