/**
 * App Store の掲載文（App 名・サブタイトル・キーワード・説明・プロモーション）を
 * `docs/store/app-store/listing-<lang>.md` の内容で更新する。
 *
 * Play 側の `update-play-listing.mjs` に相当する。**撮影と違ってアップロードは Windows からできる。**
 *
 * ## Play と決定的に違うところ
 *
 * **掲載文は `appStoreVersion` にぶら下がる。** `READY_FOR_SALE` のバージョンは編集できず、
 * Apple は 409 STATE_ERROR を返す。つまり **App Store の掲載更新は次のバージョンの申請とセット**。
 * 唯一の例外が `promotionalText` で、これだけは審査なしで変えられる。
 *
 * 書き込み先は 2 つに分かれる:
 * - `appInfoLocalizations` … App 名・サブタイトル（**バージョンをまたぐ**アプリの属性）
 * - `appStoreVersionLocalizations` … 説明・キーワード・プロモーション・新機能・URL（**バージョンごと**）
 *
 * 使い方:
 *   node scripts/release/update-appstore-listing.mjs [--lang ja|en] [--dry-run]
 *     [--version 1.12.1]   # 編集可能なバージョンが複数あるとき、どれに書くか
 *     [--promo-only]       # プロモーションテキストだけ更新（審査不要）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAscClient, findEditableVersion, readAscConfig } from './lib/asc-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 原稿の場所と ASC のロケール名。 */
const SOURCE_BY_LANG = {
  ja: { file: 'docs/store/app-store/listing-ja.md', locale: 'ja' },
  en: { file: 'docs/store/app-store/listing-en.md', locale: 'en-US' },
};

/** ASC のフィールド上限（超えると 422 で弾かれる）。 */
const LIMITS = {
  name: 30,
  subtitle: 30,
  keywords: 100,
  description: 4000,
  promotionalText: 170,
  whatsNew: 4000,
};

const args = parseArgs(process.argv.slice(2));
const source = SOURCE_BY_LANG[args.lang];
if (!source) throw new Error(`--lang は ${Object.keys(SOURCE_BY_LANG).join(' / ')} のいずれか`);

const md = fs.readFileSync(path.join(ROOT, source.file), 'utf8');

/**
 * Play 側と同じく `## 見出し` で切り出す。**マークダウンの強調はそのまま送らない** —
 * App Store も Play と同様にプレーンテキスト扱いで、`**` がそのまま見える。
 */
function section(heading, { optional = false } = {}) {
  // 見出しには「（26 文字）」のような注記が付く。**前方一致で拾う**
  const re = new RegExp(`^## ${heading}(?:[（(][^\\n]*)?\\s*$`, 'm');
  const m = re.exec(md);
  if (!m) {
    if (optional) return null;
    throw new Error(`${source.file} に「## ${heading}」が見つかりません`);
  }
  const start = m.index + m[0].length;
  const next = md.slice(start).search(/^## /m);
  const raw = next === -1 ? md.slice(start) : md.slice(start, start + next);
  // **`>` の引用は編集メモなので送らない。** この原稿は注記を blockquote で書く決まり
  const body = raw
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .trim();
  return body ? stripMarkdownEmphasis(body).replace(/^-\s*/, '').trim() : null;
}

function stripMarkdownEmphasis(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
}

const fields = {
  name: section('App 名', { optional: true }) ?? section('アプリ名', { optional: true }),
  subtitle: section('サブタイトル', { optional: true }),
  keywords: section('キーワード', { optional: true }),
  description: section('説明', { optional: true }) ?? section('詳しい説明', { optional: true }),
  promotionalText: section('プロモーションテキスト', { optional: true }),
  whatsNew: section('バージョンごとの新機能', { optional: true }),
};

for (const [key, value] of Object.entries(fields)) {
  if (value == null) continue;
  if (/\*/.test(value))
    throw new Error(`${key} に \`*\` が残っています（マークダウンの取りこぼし）`);
  const limit = LIMITS[key];
  if (limit && value.length > limit) {
    throw new Error(`${key} が ${limit} 字を超えています: ${value.length} 字`);
  }
}

console.log(`[${source.locale}] ${source.file}`);
for (const [key, value] of Object.entries(fields)) {
  console.log(
    `  ${key.padEnd(16)} ${value == null ? '(原稿に無し → 触らない)' : `${value.length}字`}`,
  );
}

const cfg = readAscConfig();
const client = createAscClient();

// ─── 書き込み先を決める ───────────────────────────────────────────────────────
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
      '**App Store の掲載文はバージョンにぶら下がるので、READY_FOR_SALE のものは変更できません。**',
      '新しいバージョン（例 1.12.1）を作ってから実行してください:',
      '  node scripts/release/create-appstore-version.mjs --version 1.12.1',
      'プロモーションテキストだけなら審査なしで変えられます（--promo-only）。',
    ].join('\n'),
  );
}
console.log(
  `対象バージョン: ${version.attributes.versionString} (${version.attributes.appStoreState})`,
);

if (args.dryRun) {
  console.log('--- dry-run: 送信せず終了 ---');
  if (fields.name) console.log(fields.name);
  if (fields.subtitle) console.log(fields.subtitle);
  process.exit(0);
}

// ─── appInfoLocalizations（App 名・サブタイトル） ─────────────────────────────
if (!args.promoOnly && (fields.name || fields.subtitle)) {
  const infos = await client.getAll(`/v1/apps/${cfg.ascAppId}/appInfos`);
  // 編集できる appInfo は 1 つだけ（READY_FOR_SALE のものは触れない）
  const editableInfo =
    infos.find((i) => i.attributes.appStoreState !== 'READY_FOR_SALE') ?? infos[0];
  const locs = await client.getAll(`/v1/appInfos/${editableInfo.id}/appInfoLocalizations`);
  const loc = locs.find((l) => l.attributes.locale === source.locale);

  const attributes = {
    ...(fields.name ? { name: fields.name } : {}),
    ...(fields.subtitle ? { subtitle: fields.subtitle } : {}),
  };

  if (loc) {
    await client.patch(`/v1/appInfoLocalizations/${loc.id}`, {
      data: { type: 'appInfoLocalizations', id: loc.id, attributes },
    });
    console.log(`appInfoLocalization 更新: ${source.locale}`);
  } else {
    await client.post('/v1/appInfoLocalizations', {
      data: {
        type: 'appInfoLocalizations',
        attributes: { locale: source.locale, ...attributes },
        relationships: { appInfo: { data: { type: 'appInfos', id: editableInfo.id } } },
      },
    });
    console.log(`appInfoLocalization 新規作成: ${source.locale}`);
  }
}

// ─── appStoreVersionLocalizations（説明・キーワード・プロモ・新機能） ─────────
const versionLocs = await client.getAll(
  `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`,
);
const versionLoc = versionLocs.find((l) => l.attributes.locale === source.locale);

const versionAttributes = args.promoOnly
  ? { ...(fields.promotionalText ? { promotionalText: fields.promotionalText } : {}) }
  : {
      ...(fields.description ? { description: fields.description } : {}),
      ...(fields.keywords ? { keywords: fields.keywords } : {}),
      ...(fields.promotionalText ? { promotionalText: fields.promotionalText } : {}),
      ...(fields.whatsNew ? { whatsNew: fields.whatsNew } : {}),
    };

if (Object.keys(versionAttributes).length === 0) {
  console.log('バージョン側に送る欄がありません（原稿に該当の節が無い）');
} else if (versionLoc) {
  await client.patch(`/v1/appStoreVersionLocalizations/${versionLoc.id}`, {
    data: {
      type: 'appStoreVersionLocalizations',
      id: versionLoc.id,
      attributes: versionAttributes,
    },
  });
  console.log(`appStoreVersionLocalization 更新: ${source.locale}`);
} else {
  await client.post('/v1/appStoreVersionLocalizations', {
    data: {
      type: 'appStoreVersionLocalizations',
      attributes: { locale: source.locale, ...versionAttributes },
      relationships: {
        appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
      },
    },
  });
  console.log(`appStoreVersionLocalization 新規作成: ${source.locale}`);
}

console.log('完了');

function parseArgs(argv) {
  const parsed = { lang: 'ja', dryRun: false, promoOnly: false, version: null };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--lang') parsed.lang = argv[++i];
    else if (t === '--version') parsed.version = argv[++i];
    else if (t === '--dry-run') parsed.dryRun = true;
    else if (t === '--promo-only') parsed.promoOnly = true;
  }
  return parsed;
}
