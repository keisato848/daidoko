/**
 * App Store のスマホ用スクリーンショットを
 * `docs/store/app-store/phone-screenshots<-locale>/` の内容で差し替える。
 *
 * Play 側の `update-play-screenshots.mjs` に相当する。**撮影は macOS が要るが、
 * アップロードは Windows からできる**（`docs/store/app-store/SUBMISSION.md`）。
 *
 * ## Play と違うところ
 *
 * - **スクショはロケールごとに別のセット**（`appScreenshotSets`）。日英を出すなら 2 セット要る
 * - **バージョンにぶら下がる**ので、`READY_FOR_SALE` のバージョンには入れられない
 * - アップロードは 3 段階: **予約（POST）→ 実体を PUT → MD5 を添えて commit（PATCH）**
 * - 並び順は最後に `relationships/appScreenshots` を PATCH して確定させる。
 *   **セットを作り直してから入れる**のがいちばん確実（SUBMISSION.md の実績）
 *
 * 使い方:
 *   node scripts/release/update-appstore-screenshots.mjs [--lang ja|en] [--dry-run]
 *     [--version 1.12.1] [--keep-set]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAscClient, findEditableVersion, readAscConfig } from './lib/asc-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** iPhone 6.9"（1320x2868）。宣言しているデバイスファミリーぶんだけ求められる。 */
const DISPLAY_TYPE = 'APP_IPHONE_67';

const SOURCE_BY_LANG = {
  ja: { dir: 'docs/store/app-store/phone-screenshots', locale: 'ja' },
  en: { dir: 'docs/store/app-store/phone-screenshots-en', locale: 'en-US' },
};

/**
 * 表示順。Play 側（`update-play-screenshots.mjs` の ORDER）と揃える。
 * 1.13.1（2026-09-05）: 1 枚目に 05 献立・3 枚目に 12 冷蔵庫確認シート。
 * 03・04 は extras/ へ退避（経緯は phone-screenshots/README.md と
 * docs/store/google-play/phone-screenshots/README.md の 1.13.1 節）。
 * 撮影手順は phone-screenshots/SHOOTING-1.13.1.md。
 */
const ORDER = [
  '05-menu-plan.png',
  '10-recipe-detail-photo.png',
  '12-fridge-to-recipe.png',
  '07-photo-to-recipe.png',
  '08-photo-recipe-result.png',
  '01-home-timeline.png',
  '02-recipe-library.png',
  '06-family-group.png',
];

const args = parseArgs(process.argv.slice(2));
const source = SOURCE_BY_LANG[args.lang];
if (!source) throw new Error(`--lang は ${Object.keys(SOURCE_BY_LANG).join(' / ')} のいずれか`);
const dir = path.join(ROOT, source.dir);

// ─── 検証（存在・PNG・寸法が揃っているか） ──────────────────────────────────
if (ORDER.length > 10) throw new Error(`App Store のスクショは最大10枚（現在 ${ORDER.length}）`);
const plan = ORDER.map((file) => {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) throw new Error(`missing: ${source.dir}/${file}`);
  const b = fs.readFileSync(p);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`not PNG: ${file}`);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  return { file, path: p, bytes: b, dims: `${w}x${h}`, kb: Math.round(b.length / 1024) };
});

/**
 * **寸法が揃っているか。** Play 側と同じ理由 — 一部だけ撮り直すと混ざり、
 * 1 枚ごとの検査では素通りする。
 */
const dimsSeen = [...new Set(plan.map((s) => s.dims))];
if (dimsSeen.length > 1) {
  const byDim = dimsSeen
    .map(
      (d) =>
        `${d}: ${plan
          .filter((s) => s.dims === d)
          .map((s) => s.file)
          .join(', ')}`,
    )
    .join(' / ');
  throw new Error(`スクショの寸法が揃っていません（同じシミュレータで撮り直すこと） — ${byDim}`);
}

console.log(`plan (${plan.length} files, ${source.locale}/${DISPLAY_TYPE}):`);
for (const [i, s] of plan.entries()) console.log(`  ${i + 1}. ${s.file} ${s.dims} ${s.kb}KB`);

if (args.dryRun) {
  console.log('--- dry-run: 送信せず終了 ---');
  process.exit(0);
}

const cfg = readAscConfig();
const client = createAscClient();

const version = args.version
  ? (
      await client.getAll(
        `/v1/apps/${cfg.ascAppId}/appStoreVersions?limit=20&fields[appStoreVersions]=versionString,appStoreState`,
      )
    ).find((v) => v.attributes.versionString === args.version)
  : await findEditableVersion(client, cfg.ascAppId);

if (!version) {
  throw new Error(
    [
      '編集できるバージョンがありません。',
      '**App Store のスクショはバージョンにぶら下がるので、READY_FOR_SALE のものは変更できません。**',
      '新しいバージョンを作ってから実行してください:',
      '  node scripts/release/create-appstore-version.mjs --version 1.12.1',
    ].join('\n'),
  );
}
console.log(
  `対象バージョン: ${version.attributes.versionString} (${version.attributes.appStoreState})`,
);

// ─── ロケールのセットを用意（既定では作り直す） ─────────────────────────────
const locs = await client.getAll(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
const loc = locs.find((l) => l.attributes.locale === source.locale);
if (!loc) {
  throw new Error(
    `${source.locale} の appStoreVersionLocalization がありません。` +
      '先に update-appstore-listing.mjs で掲載文を入れてください（ロケールが作られます）。',
  );
}

const sets = await client.getAll(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`);
let set = sets.find((s) => s.attributes.screenshotDisplayType === DISPLAY_TYPE);

if (set && !args.keepSet) {
  // **作り直すと順序が確実**（既存を消してから入れると並べ替えの PATCH が効きやすい）
  await client.delete(`/v1/appScreenshotSets/${set.id}`);
  console.log(`既存セットを削除: ${set.id}`);
  set = null;
}

if (!set) {
  const created = await client.post('/v1/appScreenshotSets', {
    data: {
      type: 'appScreenshotSets',
      attributes: { screenshotDisplayType: DISPLAY_TYPE },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: 'appStoreVersionLocalizations', id: loc.id },
        },
      },
    },
  });
  set = created.data;
  console.log(`セットを作成: ${set.id}`);
}

// ─── 予約 → PUT → commit ────────────────────────────────────────────────────
const uploadedIds = [];
for (const shot of plan) {
  const reserved = await client.post('/v1/appScreenshots', {
    data: {
      type: 'appScreenshots',
      attributes: { fileSize: shot.bytes.length, fileName: shot.file },
      relationships: {
        appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } },
      },
    },
  });
  const id = reserved.data.id;
  const operations = reserved.data.attributes.uploadOperations ?? [];

  for (const op of operations) {
    const headers = {};
    for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
    const chunk = shot.bytes.subarray(op.offset, op.offset + op.length);
    const res = await fetch(op.url, { method: op.method, headers, body: chunk });
    if (!res.ok) {
      throw new Error(`${shot.file} のアップロードに失敗: ${res.status} ${await res.text()}`);
    }
  }

  // **MD5 を添えないと COMPLETE にならない**（Apple 側でチェックしている）
  const checksum = createHash('md5').update(shot.bytes).digest('hex');
  await client.patch(`/v1/appScreenshots/${id}`, {
    data: {
      type: 'appScreenshots',
      id,
      attributes: { uploaded: true, sourceFileChecksum: checksum },
    },
  });
  uploadedIds.push(id);
  console.log(`uploaded: ${shot.file} -> ${id}`);
}

// ─── 並べ替え ────────────────────────────────────────────────────────────────
await client.patch(`/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, {
  data: uploadedIds.map((id) => ({ type: 'appScreenshots', id })),
});
console.log('順序を確定しました');

// ─── 反映確認 ────────────────────────────────────────────────────────────────
const final = await client.getAll(
  `/v1/appScreenshotSets/${set.id}/appScreenshots?fields[appScreenshots]=fileName,assetDeliveryState`,
);
console.log(`\n=== ${source.locale} / ${DISPLAY_TYPE} ===`);
for (const [i, s] of final.entries()) {
  console.log(
    `  ${i + 1}. ${s.attributes.fileName} ${s.attributes.assetDeliveryState?.state ?? '?'}`,
  );
}
const bad = final.filter((s) => s.attributes.assetDeliveryState?.state !== 'COMPLETE');
if (bad.length > 0) {
  console.warn(
    `\nWARN: COMPLETE でないものが ${bad.length} 件あります。少し待って再確認してください`,
  );
}

function parseArgs(argv) {
  const parsed = { lang: 'ja', dryRun: false, version: null, keepSet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--lang') parsed.lang = argv[++i];
    else if (t === '--version') parsed.version = argv[++i];
    else if (t === '--dry-run') parsed.dryRun = true;
    else if (t === '--keep-set') parsed.keepSet = true;
  }
  return parsed;
}
