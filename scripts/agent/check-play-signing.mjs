import { classifySigningEnv, SIGNING_ENV_KEYS, verifyKeystoreFile } from './lib/signing.mjs';

/**
 * Strict Play Store signing readiness check.
 *
 * Exit codes:
 *   0 — all signing env vars set and keystore file exists
 *   1 — any check failed
 *
 * Unlike preflight (which tolerates 'none' for local APK work),
 * this script requires all four env vars and a readable keystore.
 */

const jsonMode = process.argv.includes('--json');
const result = await checkPlaySigning();

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  console.log(`Play signing readiness: ${result.ok ? 'OK' : 'FAILED'}`);
  for (const entry of result.checks) {
    console.log(`${entry.ok ? '[OK]' : '[NG]'} ${entry.label}: ${entry.detail}`);
  }
}

if (!result.ok) {
  process.exitCode = 1;
}

async function checkPlaySigning() {
  const checks = [];

  // 1. Check all env vars are set
  const env = classifySigningEnv();

  if (env.status === 'none') {
    checks.push({
      id: 'env-vars',
      label: 'Signing environment variables',
      ok: false,
      detail: `None of the ${SIGNING_ENV_KEYS.length} required variables are set: ${SIGNING_ENV_KEYS.join(', ')}`,
    });
    return { ok: false, checks };
  }

  if (env.status === 'partial') {
    checks.push({
      id: 'env-vars',
      label: 'Signing environment variables',
      ok: false,
      detail: `Partially configured. Missing: ${env.missing.join(', ')}`,
    });
    return { ok: false, checks };
  }

  checks.push({
    id: 'env-vars',
    label: 'Signing environment variables',
    ok: true,
    detail: `All ${SIGNING_ENV_KEYS.length} variables set`,
  });

  // 2. Check keystore file exists and is readable
  try {
    const keystorePath = await verifyKeystoreFile();
    checks.push({
      id: 'keystore-file',
      label: 'Keystore file',
      ok: true,
      detail: keystorePath,
    });
  } catch (error) {
    checks.push({
      id: 'keystore-file',
      label: 'Keystore file',
      ok: false,
      detail: `${process.env.DAIDOKO_UPLOAD_STORE_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
  };
}
