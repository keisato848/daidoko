/**
 * 編集中の App Store バージョンにビルドを紐づけて審査へ出す。
 *
 * ASC の審査提出は 2 段構え（2026-09-03 に 1.13.0 で通した形）:
 *   1. `appStoreVersions` の build リレーションを PATCH（Console の「ビルドを追加」に相当）
 *   2. `reviewSubmissions` を作り、そこへ appStoreVersion を item として載せ、
 *      `submitted: true` に PATCH（Console の「審査へ提出」に相当）
 *
 * 使い方:
 *   node scripts/release/submit-appstore-version.mjs --version 1.13.0 --build-number 10034 [--dry-run]
 *
 * 前提:
 *   - バージョンは作成済み（create-appstore-version.mjs）で PREPARE_FOR_SUBMISSION
 *   - 掲載文（whatsNew 含む）は update-appstore-listing.mjs で反映済み
 *   - ビルドは eas submit で ASC に届き processingState: VALID
 *   - 輸出コンプライアンスは ITSAppUsesNonExemptEncryption: false で申告不要
 */
import { createAscClient, listVersions, readAscConfig } from './lib/asc-api.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.version) throw new Error('--version <x.y.z> が要ります');
if (!args.buildNumber) throw new Error('--build-number <NNNNN> が要ります');

const cfg = readAscConfig();
const client = createAscClient();

const versions = await listVersions(client, cfg.ascAppId);
const version = versions.find((v) => v.attributes.versionString === args.version);
if (!version) throw new Error(`バージョン ${args.version} が ASC にありません`);
console.log(`バージョン: ${args.version} (${version.attributes.appStoreState}) ${version.id}`);

const builds = await client.getAll(
  `/v1/builds?filter[app]=${cfg.ascAppId}&filter[version]=${args.buildNumber}&limit=5`,
);
const build = builds.find((b) => !b.attributes.expired);
if (!build) throw new Error(`build ${args.buildNumber} が ASC にありません（処理待ちの可能性）`);
if (build.attributes.processingState !== 'VALID') {
  throw new Error(`build ${args.buildNumber} は ${build.attributes.processingState}（VALID 待ち）`);
}
console.log(`ビルド: ${args.buildNumber} (${build.attributes.processingState}) ${build.id}`);

if (args.dryRun) {
  console.log('--- dry-run: 紐づけも提出もせず終了 ---');
  process.exit(0);
}

await client.patch(`/v1/appStoreVersions/${version.id}/relationships/build`, {
  data: { type: 'builds', id: build.id },
});
console.log('ビルドを紐づけました');

/**
 * 既に開いている reviewSubmission があれば使い回す（二重に作ると 409）。
 */
const open = await client.getAll(
  `/v1/reviewSubmissions?filter[app]=${cfg.ascAppId}&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES&limit=5`,
);
let submission = open[0];
if (submission) {
  console.log(`既存の審査提出を使う: ${submission.id} (${submission.attributes.state})`);
} else {
  const created = await client.post('/v1/reviewSubmissions', {
    data: {
      type: 'reviewSubmissions',
      attributes: { platform: 'IOS' },
      relationships: { app: { data: { type: 'apps', id: cfg.ascAppId } } },
    },
  });
  submission = created.data;
  console.log(`審査提出を作成: ${submission.id}`);
}

await client.post('/v1/reviewSubmissionItems', {
  data: {
    type: 'reviewSubmissionItems',
    relationships: {
      reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } },
      appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
    },
  },
});
console.log('バージョンを審査提出に載せました');

await client.patch(`/v1/reviewSubmissions/${submission.id}`, {
  data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } },
});
console.log('審査へ提出しました（WAITING_FOR_REVIEW になります）');

function parseArgs(argv) {
  const parsed = { version: null, buildNumber: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--version') parsed.version = argv[++i];
    else if (t === '--build-number') parsed.buildNumber = argv[++i];
    else if (t === '--dry-run') parsed.dryRun = true;
  }
  return parsed;
}
