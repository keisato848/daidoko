# daidoko infra (AWS CDK)

Serverless deploy for the Vision **inference server** (`apps/server`) — a Hono app
on AWS **Lambda** behind a public **Function URL**, with **cost guardrails**.

```
[Mobile app] --HTTPS--> [Lambda Function URL] --> [Hono app] --> [Gemini API]
```

## What this stack creates

- **Lambda** (Node 20, arm64, 512 MB, 60 s timeout) bundling `apps/server/src/lambda.ts`.
- **Function URL** (public, no auth — same posture as the current Railway server).
- **Reserved concurrency = 5** — hard cap on parallel executions (cost guard).
- **AWS Budgets**: monthly **COST** budget (default **$5**) with email alerts at
  50 / 80 / 100 % (actual) and 100 % (forecast).
- **CloudWatch alarms** → SNS email: daily invocations over the global cap, and error spikes.

> The variable cost is the **Gemini API** (billed by Google, not AWS). Also set a
> **quota in Google AI Studio** — that is the real cap on Gemini spend. The
> in-app daily limits (`INFER_DAILY_LIMIT` / `INFER_GLOBAL_DAILY_LIMIT`) are
> best-effort on Lambda (in-memory, per warm instance); strict enforcement would
> need a shared store (DynamoDB) — see "Follow-ups".
>
> **Freemium:** the per-user free quota (1 AI photo-recipe/day) is enforced
> **client-side**, and premium is validated by **RevenueCat** — these server caps
> are only cost / abuse guards (no auth here, so the server can't tell premium
> from free). Keep `INFER_DAILY_LIMIT` generous or `0` so it never blocks a
> paying household sharing one IP. See `docs/フリーミアム設計.md`.

## Prerequisites (one-time)

1. An **AWS account** + the **AWS CLI** configured: `aws configure` (or SSO).
   Verify: `aws sts get-caller-identity`.
2. Node 20. Repo deps installed from the **repo root** (`pnpm install`) so the
   server's modules resolve for bundling.
3. Install infra deps (this folder is standalone, not in the pnpm workspace):
   ```bash
   cd infra && npm install
   ```
4. Bootstrap CDK once per account/region (default region `ap-northeast-1`):
   ```bash
   npx cdk bootstrap
   ```

## Deploy

Provide the secret + alert email via env (never commit them):

```bash
cd infra
GEMINI_API_KEY="<your key>" \
ALERT_EMAIL="you@example.com" \
AWS_REGION="ap-northeast-1" \
npx cdk deploy
```

Optional env: `GEMINI_MODEL`, `MONTHLY_BUDGET_USD` (default 5).

After deploy:

1. **Confirm the SNS subscription** — check `ALERT_EMAIL` inbox and click _Confirm_
   (alerts won't arrive until confirmed).
2. Copy the **`FunctionUrl`** output and set it as the mobile build's
   `EXPO_PUBLIC_SERVER_URL` (without trailing slash):
   ```bash
   EXPO_PUBLIC_SERVER_URL="https://xxxx.lambda-url.ap-northeast-1.on.aws" \
     node scripts/agent/build-android.mjs --arch arm64-v8a
   ```
3. **Set a Gemini quota** in Google AI Studio / Cloud Console (cap requests-per-day)
   as the Gemini-side cost ceiling.

Smoke test:

```bash
curl -s "<FunctionUrl>/health"
```

## Cost guardrails — summary

| Layer            | Mechanism                                      | Effect                         |
| ---------------- | ---------------------------------------------- | ------------------------------ |
| AWS spend        | AWS Budgets $5 + email alerts (50/80/100%)     | Notifies before/at the cap     |
| Parallelism      | Lambda reserved concurrency = 5                | Bounds concurrent Gemini calls |
| Anomaly          | CloudWatch alarms (invocations/errors) → email | Early warning                  |
| Gemini spend     | Google AI Studio quota (set manually)          | Hard cap on Gemini cost        |
| Per-day requests | `INFER_*_LIMIT` (in-app)                       | Best-effort on Lambda          |

> AWS Budgets **alerts** by default; it does not auto-stop spend. A true auto-stop
> needs a **Budget Action** (console) or a kill-switch Lambda — see Follow-ups.

## Secret handling

`GEMINI_API_KEY` is set as a Lambda environment variable (encrypted at rest;
visible only to AWS account admins). It also appears in the CloudFormation
template (account-private). For stricter hygiene, move it to **SSM SecureString
/ Secrets Manager** and read it at runtime — see Follow-ups.

## Teardown

```bash
cd infra && npx cdk destroy
```

## Follow-ups (not in this MVP)

- DynamoDB-backed rate limiter for strict global per-day caps on Lambda.
- AWS Budgets **Action** (auto-apply a deny policy at 100%) for a hard stop.
- Move `GEMINI_API_KEY` to SSM SecureString / Secrets Manager + runtime fetch.
- Custom domain (Function URL gives an `*.on.aws` HTTPS URL out of the box).
