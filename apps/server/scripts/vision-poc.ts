/**
 * Vision inference PoC runner — exercises the real provider + agent against a
 * dish image and prints the resulting RecipeDraft. Intended to run inside a
 * GitHub Actions job where GEMINI_API_KEY is injected from repository secrets
 * (so the key value is never exposed locally or in logs).
 *
 * Usage: tsx apps/server/scripts/vision-poc.ts <imagePath> [contextText]
 */
import { readFileSync } from 'node:fs';

import { runPhotoInferAgent } from '../src/agents/photo-infer.agent.js';
import { GeminiVisionRecipeProvider } from '../src/lib/vision-recipe.js';

const imagePath = process.argv[2];
const context = process.argv[3];

if (!imagePath) {
  process.stderr.write('Usage: tsx vision-poc.ts <imagePath> [contextText]\n');
  process.exit(2);
}

function mimeTypeFor(path: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function main(): Promise<void> {
  const imageBase64 = readFileSync(imagePath).toString('base64');
  const mimeType = mimeTypeFor(imagePath);

  process.stdout.write(`\n=== Vision PoC ===\n`);
  process.stdout.write(`image: ${imagePath} (${mimeType}, ${imageBase64.length} b64 chars)\n`);
  process.stdout.write(`context: ${context ?? '(none)'}\n`);
  process.stdout.write(`model: ${process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash'}\n\n`);

  const startedAt = Date.now();
  const provider = new GeminiVisionRecipeProvider();
  const result = await runPhotoInferAgent(
    { imageBase64, mimeType, ...(context ? { context } : {}) },
    provider,
  );
  const elapsedMs = Date.now() - startedAt;

  process.stdout.write(`--- result (ok=${result.ok}, ${elapsedMs}ms) ---\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`PoC failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
