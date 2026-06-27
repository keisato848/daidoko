/**
 * AWS Lambda entry point (invoked via a Lambda Function URL).
 *
 * Wraps the Hono app with the built-in aws-lambda adapter. It imports the app
 * from app.ts (not index.ts), so the Node HTTP bootstrap and its top-level
 * await are never pulled into the Lambda bundle.
 */
import { handle } from 'hono/aws-lambda';

import { app } from './app.js';

export const handler = handle(app);
