---
name: e2e-triage
description: 'Use when Android E2E, OCR E2E, or photo recipe E2E fails and you need a quick summary, likely root causes, and the next recovery step.'
user-invocable: true
argument-hint: 'Pass a result json path or ask for all known E2E result files'
---

# E2E Triage

## When To Use
- After `android-e2e.mjs`, `android-ocr-e2e.mjs`, or `android-photo-recipe-e2e.mjs` fails.
- When a report exists but the user should not have to inspect raw JSON.

## Procedure
1. Run `pnpm agent:triage:e2e -- --file <result-json>`.
2. Review the failing cases, inferred hints, and recovery steps.
3. If the issue is environment-related, fix the environment first and rerun the same suite.
4. If the issue is product-related, narrow to the owning code path and validate the same suite again after the fix.