/**
 * 製品版トラックのリリースノートを設定する。
 *
 * **掲載言語のぶんだけ入れる。** ja-JP しか入れないと、英語の利用者には
 * 日本語のリリースノートが表示される（掲載文だけ英語にしても意味がない）。
 *
 * `eas submit` は AAB を上げるがリリースノートは設定しない。Play Console を手で開く
 * 代わりに API で入れる。1.4.2 以降この手順を踏んでいる（docs/リリース手順.md）。
 *
 * **`eas submit` の実行中に叩かないこと。** Play はアプリごとに同時に1つの edit しか
 * 持てず、衝突すると submit が "This Edit has been deleted." で落ちる（1.4.3 で被弾）。
 *
 * 使い方:
 *   node scripts/release/update-play-release-notes.mjs --notes-file <ja.txt> [--notes-file-en <en.txt>] [--dry-run]
 */
import { readFileSync } from 'node:fs';

import { API_BASE, createEditsClient, getAccessToken } from './lib/play-api.mjs';

const options = parseArgs(process.argv.slice(2));
if (!options.notesFile) {
  console.error('--notes-file <path> を指定してください。');
  process.exit(1);
}

/** Play の上限は 500 文字。超えると PUT が 400 で落ちるので先に止める。 */
function readNotes(path, label) {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) {
    console.error(`${label} のリリースノートが空です。`);
    process.exit(1);
  }
  if (text.length > 500) {
    console.error(
      `${label} のリリースノートが ${text.length} 文字です（Play の上限は 500）。短くしてください。`,
    );
    process.exit(1);
  }
  return text;
}

const releaseNotes = [{ language: 'ja-JP', text: readNotes(options.notesFile, 'ja-JP') }];
if (options.notesFileEn) {
  releaseNotes.push({ language: 'en-US', text: readNotes(options.notesFileEn, 'en-US') });
}

const accessToken = await getAccessToken();
const edits = createEditsClient(accessToken);

async function request(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `${init?.method ?? 'GET'} ${url} -> ${res.status} ${JSON.stringify(body).slice(0, 400)}`,
    );
  return body;
}

const edit = await edits.insert();
console.log(`edit: ${edit.id}`);

const track = await request(`${API_BASE}/edits/${edit.id}/tracks/production`, { method: 'GET' });
const releases = track.releases ?? [];
if (releases.length === 0) {
  console.error(
    'production トラックにリリースがありません。submit が完了しているか確認してください。',
  );
  process.exit(1);
}

// 直近のリリース（submit したもの）にノートを付ける
const target = releases[releases.length - 1];
console.log(`対象: versionCodes=${(target.versionCodes ?? []).join(',')} status=${target.status}`);
console.log('--- 設定するリリースノート ---');
for (const entry of releaseNotes) {
  console.log(`[${entry.language}]
${entry.text}
`);
}

if (options.dryRun) {
  console.log('\n--dry-run のため書き込みませんでした。');
  process.exit(0);
}

target.releaseNotes = releaseNotes;
await request(`${API_BASE}/edits/${edit.id}/tracks/production`, {
  method: 'PUT',
  body: JSON.stringify({ track: 'production', releases }),
});
await edits.commit(edit.id);
console.log('\nリリースノートを設定しました。');

function parseArgs(argv) {
  const parsed = { notesFile: null, notesFileEn: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--notes-file' && argv[index + 1]) {
      parsed.notesFile = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--notes-file-en' && argv[index + 1]) {
      parsed.notesFileEn = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--dry-run') {
      parsed.dryRun = true;
    }
  }
  return parsed;
}
