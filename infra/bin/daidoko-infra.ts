#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { InferenceStack } from '../lib/inference-stack';

const app = new cdk.App();

// Secrets / config come from the deploy environment (never committed).
const geminiApiKey = process.env.GEMINI_API_KEY ?? app.node.tryGetContext('geminiApiKey');
const alertEmail = process.env.ALERT_EMAIL ?? app.node.tryGetContext('alertEmail');

if (!geminiApiKey) {
  throw new Error('GEMINI_API_KEY is required (env var or `-c geminiApiKey=...`).');
}
if (!alertEmail) {
  throw new Error('ALERT_EMAIL is required (env var or `-c alertEmail=...`).');
}

new InferenceStack(app, 'DaidokoInference', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
  },
  geminiApiKey,
  alertEmail,
  ...(process.env.GEMINI_MODEL ? { geminiModel: process.env.GEMINI_MODEL } : {}),
  ...(process.env.MONTHLY_BUDGET_USD
    ? { monthlyBudgetUsd: Number(process.env.MONTHLY_BUDGET_USD) }
    : {}),
});
