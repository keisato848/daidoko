/**
 * cover-image（レシピ表紙の AI イメージ生成）の実呼び出し検証＋品質サンプル。
 * 背景: docs/レシピ表紙AI生成設計.md §7-1 — GeminiCoverImageProvider は
 * Interactions API 仕様に合わせて実装したが実呼び出し未検証だった。
 *
 * 使い方（apps/server/ で実行、vision-eval.ts と同じ tsx 直接呼び出し）:
 *   npx tsx scripts/cover-image-check.ts probe
 *     — 1 回だけ生の fetch を叩き、レスポンスの実フィールド名をそのまま出す
 *       （GeminiCoverImageProvider を経由しない。フィールド不一致でも中身が見える）
 *   npx tsx scripts/cover-image-check.ts batch --out ../../docs/eval/cover-image
 *     — 和食 10 題を既定モデルで、うち 3 題は COVER_IMAGE_MODEL=gemini-3.1-flash-image
 *       でも生成し、JPEG として --out に保存する
 *
 * 鍵は apps/server/.env の GEMINI_API_KEY を読む（このファイル自身は dotenv を
 * 使わないので、簡易パーサで読み込んで process.env に積む。値は出力しない）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GeminiCoverImageProvider, type CoverImageInput } from '../src/lib/cover-image.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── .env 読み込み（vision-eval.ts の前例に従い、鍵は apps/server/.env から） ──
function loadEnvFile(): void {
  const envPath = path.join(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}
loadEnvFile();

const GEMINI_INTERACTIONS_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/interactions';

function requireApiKey(): string {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    process.stderr.write('GEMINI_API_KEY が未設定（apps/server/.env を確認）\n');
    process.exit(2);
  }
  return apiKey;
}

// ─── サンプル題材（和食中心 10 題。ファイル名 = ローマ字） ───────────────────
const SAMPLE_DISHES: { id: string; title: string; ingredients: string[]; tags: string[] }[] = [
  {
    id: 'nikujaga',
    title: '肉じゃが',
    ingredients: ['牛肉', 'じゃがいも', '玉ねぎ', 'にんじん', 'しらたき'],
    tags: ['和食', '煮物'],
  },
  {
    id: 'misoshiru',
    title: '味噌汁',
    ingredients: ['豆腐', 'わかめ', '長ねぎ', '味噌', 'だし'],
    tags: ['和食', '汁物'],
  },
  {
    id: 'karaage',
    title: '唐揚げ',
    ingredients: ['鶏もも肉', '醤油', 'にんにく', '生姜', '片栗粉'],
    tags: ['和食', '揚げ物'],
  },
  {
    id: 'curry-rice',
    title: 'カレーライス',
    ingredients: ['牛肉', 'じゃがいも', '玉ねぎ', 'にんじん', 'カレールー', 'ご飯'],
    tags: ['洋食', '定番'],
  },
  {
    id: 'dashimaki-tamago',
    title: 'だし巻き卵',
    ingredients: ['卵', 'だし', '醤油', 'みりん'],
    tags: ['和食', '卵料理'],
  },
  {
    id: 'horenso-no-ohitashi',
    title: 'ほうれん草のおひたし',
    ingredients: ['ほうれん草', '醤油', 'かつお節', 'だし'],
    tags: ['和食', '副菜'],
  },
  {
    id: 'shogayaki',
    title: '生姜焼き',
    ingredients: ['豚ロース肉', '生姜', '醤油', '玉ねぎ'],
    tags: ['和食', '定番'],
  },
  {
    id: 'takikomigohan',
    title: '炊き込みご飯',
    ingredients: ['米', '鶏肉', 'にんじん', 'ごぼう', 'しいたけ', '醤油'],
    tags: ['和食', 'ご飯もの'],
  },
  {
    id: 'mapo-tofu',
    title: '麻婆豆腐',
    ingredients: ['豆腐', '豚ひき肉', '豆板醤', 'ねぎ', 'にんにく'],
    tags: ['中華', '辛い'],
  },
  {
    id: 'napolitan',
    title: 'ナポリタン',
    ingredients: ['スパゲッティ', 'ソーセージ', '玉ねぎ', 'ピーマン', 'ケチャップ'],
    tags: ['洋食', 'パスタ'],
  },
];

/**
 * 比較用に別モデルでも生成する題（当初指示は肉じゃが・味噌汁・カレーの 3 題）。
 * **2 題に縮小**: probe（表面検証）で想定 1 回のところ、レスポンス形の
 * 誤認識に気づくための再検証で 2 回叩いた（詳細は results 参照）。
 * 「合計最大 14 呼び出し」の上限を守るため、10 題(既定モデル)を優先し
 * 比較は肉じゃが・味噌汁の 2 題に減らした（2 probe + 10 既定 + 2 比較 = 14）。
 */
const COMPARE_IDS = new Set(['nikujaga', 'misoshiru']);
const COMPARE_MODEL = 'gemini-3.1-flash-image';

function toInput(dish: { title: string; ingredients: string[]; tags: string[] }): CoverImageInput {
  return {
    title: dish.title,
    ingredientNames: dish.ingredients,
    tags: dish.tags,
    outputLocale: 'ja',
  };
}

// ─── probe: 生の fetch で 1 回だけ叩き、実フィールド名を見る ────────────────
async function runProbe(): Promise<void> {
  const apiKey = requireApiKey();
  const model = process.env['COVER_IMAGE_MODEL']?.trim() || 'gemini-3.1-flash-lite-image';
  const dish = SAMPLE_DISHES[0]!; // 肉じゃが
  const input = toInput(dish);

  // GeminiCoverImageProvider.generate() と同じ body 組み立て(buildCoverImagePrompt 経由)。
  const { buildCoverImagePrompt } = await import('../src/lib/cover-image.js');
  const body = {
    model,
    input: [{ type: 'text', text: buildCoverImagePrompt(input) }],
    response_format: { type: 'image', mime_type: 'image/jpeg', image_size: '1K' },
  };

  process.stdout.write(`\n=== cover-image probe ===\n`);
  process.stdout.write(`endpoint: ${GEMINI_INTERACTIONS_ENDPOINT}\n`);
  process.stdout.write(`model: ${model}\n`);
  process.stdout.write(
    `request body (text 省略): ${JSON.stringify({ ...body, input: '(略)' })}\n\n`,
  );

  const startedAt = Date.now();
  const res = await fetch(GEMINI_INTERACTIONS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const elapsedMs = Date.now() - startedAt;

  process.stdout.write(`status: ${res.status} ${res.statusText} (${elapsedMs}ms)\n`);

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    process.stdout.write(`response is not JSON. raw (先頭 2000 文字):\n${text.slice(0, 2000)}\n`);
    return;
  }

  // トップレベルのキー名と、画像データっぽいフィールドだけ base64 を省略して出す
  const redacted = redactLongStrings(json);
  process.stdout.write(
    `response JSON (base64 相当は省略):\n${JSON.stringify(redacted, null, 2)}\n`,
  );

  if (res.ok) {
    // 実フィールドを探して画像を保存できるか試す（保存先は probe 用に別名）
    const outDir = path.resolve(__dirname, '..', '..', '..', 'docs', 'eval', 'cover-image');
    mkdirSync(outDir, { recursive: true });
    const found = findModelOutputImage(json);
    if (found) {
      writeFileSync(path.join(outDir, '_probe-nikujaga.jpg'), Buffer.from(found.data, 'base64'));
      process.stdout.write(
        `\n画像データを検出（steps[].type=model_output の content[].type=image）: mime_type=${found.mimeType}\n`,
      );
      process.stdout.write(`保存: docs/eval/cover-image/_probe-nikujaga.jpg\n`);
    } else {
      process.stdout.write(`\n画像データらしきフィールドが見つからなかった（上の JSON を参照）\n`);
    }
  }
}

/**
 * 実応答の形（2026-08-29 実測）: トップレベルに `steps: [...]` があり、
 * `type: 'thought'`（signature フィールドに大きな不透明文字列）と
 * `type: 'model_output'`（`content: [{ type: 'image', data, mime_type }]`）が混在する。
 * 画像は必ず `model_output` の `content[].type === 'image'` から取る
 * （`thought` の `signature` を誤って拾うと壊れた画像になる — 実際に踏んだ）。
 */
function findModelOutputImage(json: unknown): { data: string; mimeType: string } | null {
  if (!json || typeof json !== 'object') return null;
  const steps = (json as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    if ((step as { type?: unknown }).type !== 'model_output') continue;
    const content = (step as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      if ((item as { type?: unknown }).type !== 'image') continue;
      const data = (item as { data?: unknown }).data;
      const mimeType = (item as { mime_type?: unknown }).mime_type;
      if (typeof data === 'string' && typeof mimeType === 'string') {
        return { data, mimeType };
      }
    }
  }
  return null;
}

/** 文字列値が長い(=base64画像データらしい)フィールドを "(省略 N 文字)" に置き換える */
function redactLongStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > 200 ? `(省略 ${value.length} 文字)` : value;
  }
  if (Array.isArray(value)) return value.map(redactLongStrings);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactLongStrings(v);
    }
    return out;
  }
  return value;
}

// ─── batch: 品質サンプル 10 題（+ 3 題は比較モデルでも） ────────────────────
async function runBatch(outDirArg: string | undefined): Promise<void> {
  requireApiKey();
  const outDir = outDirArg
    ? path.resolve(process.cwd(), outDirArg)
    : path.resolve(__dirname, '..', '..', '..', 'docs', 'eval', 'cover-image');
  mkdirSync(outDir, { recursive: true });

  const defaultModel = process.env['COVER_IMAGE_MODEL']?.trim() || 'gemini-3.1-flash-lite-image';
  process.stdout.write(
    `\n=== cover-image batch ===\nout: ${outDir}\ndefault model: ${defaultModel}\n\n`,
  );

  const jobs: {
    id: string;
    title: string;
    input: CoverImageInput;
    model?: string;
    suffix: string;
  }[] = [];
  for (const dish of SAMPLE_DISHES) {
    jobs.push({ id: dish.id, title: dish.title, input: toInput(dish), suffix: '' });
  }
  for (const dish of SAMPLE_DISHES) {
    if (!COMPARE_IDS.has(dish.id)) continue;
    jobs.push({
      id: dish.id,
      title: dish.title,
      input: toInput(dish),
      model: COMPARE_MODEL,
      suffix: '-flash',
    });
  }

  const results: { id: string; model: string; ok: boolean; detail: string; ms: number }[] = [];

  for (const job of jobs) {
    const model = job.model ?? defaultModel;
    const provider = new GeminiCoverImageProvider(job.model ? { model: job.model } : undefined);
    const filename = `${job.id}${job.suffix}.jpg`;
    process.stdout.write(`--- ${job.title} (${model}) -> ${filename} ---\n`);
    const startedAt = Date.now();
    try {
      const result = await provider.generate(job.input);
      const ms = Date.now() - startedAt;
      writeFileSync(path.join(outDir, filename), Buffer.from(result.dataBase64, 'base64'));
      process.stdout.write(
        `  OK (${ms}ms, ${result.mimeType}, ${result.dataBase64.length} b64 chars)\n`,
      );
      results.push({ id: job.id, model, ok: true, detail: result.mimeType, ms });
    } catch (err) {
      const ms = Date.now() - startedAt;
      const detail = err instanceof Error ? err.message : String(err);
      process.stdout.write(`  NG (${ms}ms): ${detail}\n`);
      results.push({ id: job.id, model, ok: false, detail, ms });
    }
  }

  process.stdout.write(`\n=== summary ===\n`);
  for (const r of results) {
    process.stdout.write(`${r.ok ? 'OK' : 'NG'}\t${r.id}\t${r.model}\t${r.ms}ms\t${r.detail}\n`);
  }
  const summaryPath = path.join(outDir, '_batch-summary.json');
  writeFileSync(summaryPath, JSON.stringify(results, null, 2));
  process.stdout.write(`\nsummary JSON: ${summaryPath}\n`);
}

// ─── エントリポイント ────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'probe') {
    await runProbe();
    return;
  }
  if (cmd === 'batch') {
    const outIdx = rest.indexOf('--out');
    const out = outIdx !== -1 ? rest[outIdx + 1] : undefined;
    await runBatch(out);
    return;
  }
  process.stderr.write('Usage: tsx cover-image-check.ts probe | batch [--out <dir>]\n');
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(
    `cover-image-check failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
