---
name: aws-inference-deploy
description: 'Use when deploying or tearing down the Vision inference server on AWS (CDK Lambda + Function URL) with budget and alert guardrails.'
user-invocable: true
argument-hint: 'Provide AWS region, alert email, and the Gemini key source'
---

# AWS Inference Deploy (CDK)

## When To Use

- Deploying `apps/server` to AWS Lambda behind a public Function URL with cost guardrails.
- Moving the Vision endpoint off Railway, or standing up a personal/learning deploy.

## Procedure

Full runbook: `infra/README.md`. Summary:

1. Prereqs (once): `aws configure` then `aws sts get-caller-identity`; `pnpm install` from the
   **repo root** (so the server modules resolve for esbuild bundling); `cd infra && npm install`
   (infra is standalone, not in the pnpm workspace); `npx cdk bootstrap` per account/region.
2. Deploy (PowerShell): set `$env:GEMINI_API_KEY`, `$env:ALERT_EMAIL`, `$env:AWS_REGION`
   (default `ap-northeast-1`), then `npx cdk deploy`. Optional `MONTHLY_BUDGET_USD` (default 5),
   `GEMINI_MODEL`.
3. After deploy: **confirm the SNS subscription email**; copy the `FunctionUrl` output and use it
   as `EXPO_PUBLIC_SERVER_URL` for the mobile build; **set a Gemini quota** in Google AI Studio
   (the real cap on Gemini spend).
4. Smoke test: `curl.exe -s "<FunctionUrl>/health"`. Teardown: `cd infra && npx cdk destroy`.

## Guardrails (built into the stack)

- AWS Budgets monthly cost cap (default $5) + email alerts at 50/80/100% actual and 100% forecast.
- Lambda reserved concurrency = 5 (bounds parallel Gemini calls).
- CloudWatch alarms (invocations over the daily cap, error spikes) → SNS email.
- The freemium per-user quota is **client-side**; these are cost/abuse guards only (see
  `docs/フリーミアム設計.md`).

## Constraints

- **Never commit `GEMINI_API_KEY`** (env/SSM only). Budgets **alert**; they do not auto-stop spend.
- Revert the `TEMP(do-not-merge)` cleartext/localhost commit before any production build.
