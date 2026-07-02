/**
 * Daidoko Vision inference — serverless stack.
 *
 * - Hono server on AWS Lambda, exposed via a public Function URL (HTTPS).
 * - Cost guardrails (the whole point of this stack):
 *     1. AWS Budgets: monthly COST budget with email alerts at 50/80/100%
 *        (ACTUAL) and 100% (FORECASTED).
 *     2. Lambda reserved concurrency: hard cap on parallel executions so a
 *        runaway client cannot fan out unbounded Gemini calls.
 *     3. CloudWatch alarms (invocations over the daily cap, error spikes) → SNS email.
 *
 * The real variable cost is the Gemini API (billed by Google, not AWS); cap it
 * with a quota in Google AI Studio in addition to the in-app daily limits.
 */
import * as path from 'node:path';

import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

export interface InferenceStackProps extends StackProps {
  /** Gemini API key (kept server-side only). */
  readonly geminiApiKey: string;
  /** Email that receives budget + CloudWatch alerts. */
  readonly alertEmail: string;
  /** Gemini model id. */
  readonly geminiModel?: string;
  /** Monthly AWS cost budget in USD. */
  readonly monthlyBudgetUsd?: number;
  /** Per-client (per-IP) daily request limit. */
  readonly perClientDailyLimit?: number;
  /** Global daily request limit across all clients. */
  readonly globalDailyLimit?: number;
  /** Max concurrent Lambda executions (cost guard). */
  readonly reservedConcurrency?: number;
}

export class InferenceStack extends Stack {
  constructor(scope: Construct, id: string, props: InferenceStackProps) {
    super(scope, id, props);

    const geminiModel = props.geminiModel ?? 'gemini-2.0-flash';
    const monthlyBudgetUsd = props.monthlyBudgetUsd ?? 5;
    const perClientDailyLimit = props.perClientDailyLimit ?? 20;
    const globalDailyLimit = props.globalDailyLimit ?? 200;
    const reservedConcurrency = props.reservedConcurrency ?? 5;

    // ── Lambda (Hono app via Function URL) ──────────────────────────────────
    const fn = new NodejsFunction(this, 'InferenceFn', {
      entry: path.join(__dirname, '..', '..', 'apps', 'server', 'src', 'lambda.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(60),
      reservedConcurrentExecutions: reservedConcurrency,
      logRetention: logs.RetentionDays.TWO_WEEKS,
      depsLockFilePath: path.join(__dirname, '..', '..', 'pnpm-lock.yaml'),
      environment: {
        GEMINI_API_KEY: props.geminiApiKey,
        GEMINI_MODEL: geminiModel,
        INFER_DAILY_LIMIT: String(perClientDailyLimit),
        INFER_GLOBAL_DAILY_LIMIT: String(globalDailyLimit),
      },
      bundling: {
        // No top-level await / import.meta in the Lambda graph, so CJS is fine
        // and avoids ESM-handler quirks. AWS SDK v3 ships in the Node 20 runtime.
        format: OutputFormat.CJS,
        target: 'node20',
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    const fnUrl = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    // ── Alerts: SNS topic → email ───────────────────────────────────────────
    const alerts = new sns.Topic(this, 'AlertsTopic', {
      displayName: 'daidoko inference alerts',
    });
    alerts.addSubscription(new subs.EmailSubscription(props.alertEmail));

    // Daily invocation count over the global cap → something is off / costing money.
    fn.metricInvocations({ period: Duration.days(1), statistic: 'Sum' })
      .createAlarm(this, 'HighInvocationsAlarm', {
        alarmDescription: 'Inference Lambda invocations exceeded the daily cap',
        threshold: globalDailyLimit,
        evaluationPeriods: 1,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      })
      .addAlarmAction(new cwActions.SnsAction(alerts));

    // Error spike.
    fn.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' })
      .createAlarm(this, 'ErrorsAlarm', {
        alarmDescription: 'Inference Lambda error spike',
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      })
      .addAlarmAction(new cwActions.SnsAction(alerts));

    // ── AWS Budgets: monthly cost cap + alerts ──────────────────────────────
    const emailSubscriber = [{ subscriptionType: 'EMAIL', address: props.alertEmail }];
    new CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'daidoko-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        ...[50, 80, 100].map((threshold) => ({
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: emailSubscriber,
        })),
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: emailSubscriber,
        },
      ],
    });

    // ── Outputs ─────────────────────────────────────────────────────────────
    new CfnOutput(this, 'FunctionUrl', {
      value: fnUrl.url,
      description:
        'Set this as EXPO_PUBLIC_SERVER_URL (without trailing slash) for the mobile build',
    });
  }
}
