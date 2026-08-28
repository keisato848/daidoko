/**
 * App Store に**編集可能なバージョン**を作る。
 *
 * 掲載文もスクショも `appStoreVersion` にぶら下がるので、`READY_FOR_SALE` しか無い状態では
 * 何も変えられない（Apple は 409 STATE_ERROR を返す）。**掲載を直したいだけでも
 * 新しいバージョンが要る**、というのが Play といちばん違うところ。
 *
 * ここで作るのは器だけで、提出はしない。作ったあとに:
 *   node scripts/release/update-appstore-listing.mjs --lang ja
 *   node scripts/release/update-appstore-screenshots.mjs --lang ja
 * を流し、ビルドを紐づけてから審査へ出す。
 *
 * 使い方:
 *   node scripts/release/create-appstore-version.mjs --version 1.12.1 [--dry-run]
 *     [--copy-from 1.12.0]   # 既存バージョンのロケール（説明等）を写してから作る
 */
import {
  createAscClient,
  listVersions,
  findEditableVersion,
  readAscConfig,
} from './lib/asc-api.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.version) throw new Error('--version <x.y.z> が要ります');

const cfg = readAscConfig();
const client = createAscClient();

const versions = await listVersions(client, cfg.ascAppId);
console.log('=== いまの App Store のバージョン ===');
for (const v of versions) {
  console.log(`  ${String(v.attributes.versionString).padEnd(8)} ${v.attributes.appStoreState}`);
}

const existing = versions.find((v) => v.attributes.versionString === args.version);
if (existing) {
  console.log(
    `\n${args.version} は既にあります（${existing.attributes.appStoreState}）。作成をとばします。`,
  );
  process.exit(0);
}

const editable = await findEditableVersion(client, cfg.ascAppId);
if (editable) {
  throw new Error(
    `既に編集できるバージョンがあります: ${editable.attributes.versionString} ` +
      `(${editable.attributes.appStoreState})。\n` +
      '**同時に編集できるバージョンは 1 つだけ**なので、そちらを使うか、先に片付けてください。',
  );
}

console.log(`\n作成する: ${args.version}（PREPARE_FOR_SUBMISSION・提出はしない）`);
if (args.dryRun) {
  console.log('--- dry-run: 送信せず終了 ---');
  process.exit(0);
}

const created = await client.post('/v1/appStoreVersions', {
  data: {
    type: 'appStoreVersions',
    attributes: { platform: 'IOS', versionString: args.version },
    relationships: { app: { data: { type: 'apps', id: cfg.ascAppId } } },
  },
});
console.log(`作成しました: ${created.data.id} (${created.data.attributes.appStoreState})`);

// ロケールを写す（説明・キーワード等。**写さないと空のロケールから始まる**）
if (args.copyFrom) {
  const from = versions.find((v) => v.attributes.versionString === args.copyFrom);
  if (!from) throw new Error(`--copy-from ${args.copyFrom} が見つかりません`);
  const fromLocs = await client.getAll(
    `/v1/appStoreVersions/${from.id}/appStoreVersionLocalizations`,
  );
  for (const l of fromLocs) {
    const a = l.attributes;
    await client.post('/v1/appStoreVersionLocalizations', {
      data: {
        type: 'appStoreVersionLocalizations',
        attributes: {
          locale: a.locale,
          ...(a.description ? { description: a.description } : {}),
          ...(a.keywords ? { keywords: a.keywords } : {}),
          ...(a.promotionalText ? { promotionalText: a.promotionalText } : {}),
          ...(a.supportUrl ? { supportUrl: a.supportUrl } : {}),
          ...(a.marketingUrl ? { marketingUrl: a.marketingUrl } : {}),
        },
        relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: created.data.id } },
        },
      },
    });
    console.log(`  ロケールを写した: ${a.locale}`);
  }
  console.log('※ スクショは写らない（新しいバージョンには入れ直しが要る）');
}

console.log('\n次:');
console.log(
  `  node scripts/release/update-appstore-listing.mjs --lang ja --version ${args.version}`,
);
console.log(
  `  node scripts/release/update-appstore-screenshots.mjs --lang ja --version ${args.version}`,
);

function parseArgs(argv) {
  const parsed = { version: null, dryRun: false, copyFrom: null };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--version') parsed.version = argv[++i];
    else if (t === '--copy-from') parsed.copyFrom = argv[++i];
    else if (t === '--dry-run') parsed.dryRun = true;
  }
  return parsed;
}
