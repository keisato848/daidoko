/**
 * ストア掲載スクショ `05-menu-plan.png` 用の在庫仕込み（iOS シミュレータ・macOS 専用）。
 *
 * **`EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1` の base seed は在庫を 1 行も作らない**
 * （`apps/mobile/src/db/seed.ts` に pantry の seed が無い）。献立ショットは在庫が
 * 空だと成立しないので、撮影前にこれで仕込む。
 *
 * 仕込む中身は Play 版 README（`docs/store/google-play/phone-screenshots/README.md`
 * 「直し方: 3 日分の候補レシピ…」）の表をそのまま再現する。狙いは `missingCount` を
 * 0 に近づけて `coverage`（いまある◯品で作れる）を勝たせること。在庫がほぼ空のまま撮ると
 * `few-missing` が勝って「あと 8 品買えば」という**献立の売りと正反対の文言**が出る
 * （2026-09-01 に英語版で発覚した失敗）。
 *
 * 品目名は `apps/mobile/src/db/seed.ts` / `seed.en.ts` の ingredients と完全一致させている
 * （`src/utils/itemMatch.ts` の判定を表記ゆれですり抜けさせないため）。玉ねぎ/醤油/だし汁は
 * 3 レシピ間で重複するので**行を 2 つに割る**（片方が消費されても、もう片方が別の日に残る）。
 *
 * 使い方（`capture-ios-screenshots.mjs` で 05 を撮る前に実行する）:
 *   node scripts/release/seed-pantry-for-shots.mjs [--udid <udid>] [--lang ja|en] [--dry-run]
 *
 * SQL を文字列で組んでいるのは、シミュレータの DB を `sqlite3` CLI 越しに触るため
 * （アプリのコードではない。CLAUDE.md §5 の「文字列結合 SQL 禁止」はアプリ側の話）。
 * 値は `q()` でクォートをエスケープし、可変値は品目名・日付・epoch だけに限っている。
 */
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') {
  console.error('このスクリプトは macOS 専用です（xcrun simctl を使用）。Mac で実行してください。');
  process.exit(1);
}

const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const DRY = args.includes('--dry-run');
const LANG = get('lang', 'ja');
const UDID = get('udid', 'booted');
const BUNDLE_ID = 'com.daidoko.app';
const FAMILY_ID = 'family-001';

/** [名前, 翌日期限にするか] — 重複ぶんは行を 2 つに分ける（片方が別の日に残る） */
const ITEMS = {
  ja: [
    ['玉ねぎ', true],
    ['玉ねぎ', false],
    ['醤油', false],
    ['醤油', false],
    ['だし汁', false],
    ['だし汁', false],
    ['じゃがいも（メークイン）', false],
    ['牛薄切り肉', false],
    ['にんじん', false],
    ['みりん', false],
    ['砂糖', false],
    ['豆腐', false],
    ['わかめ', false],
    ['味噌', false],
    ['鶏もも肉', false],
    ['にんにく', false],
    ['しょうが', false],
    ['酒', false],
    ['片栗粉', false],
    ['薄力粉', false],
  ],
  en: [
    ['Onion', true],
    ['Onion', false],
    ['Soy sauce', false],
    ['Soy sauce', false],
    ['Dashi stock', false],
    ['Dashi stock', false],
    ['Potatoes (waxy)', false],
    ['Thinly sliced beef', false],
    ['Carrot', false],
    ['Mirin', false],
    ['Sugar', false],
    ['Tofu', false],
    ['Wakame seaweed', false],
    ['Miso', false],
    ['Chicken thigh', false],
    ['Garlic', false],
    ['Ginger', false],
    ['Sake', false],
    ['Potato starch', false],
    ['Plain flour', false],
  ],
};

/** src/utils/itemName.ts の normalizeItemName と同じ（NFKC → カタカナ→ひらがな → 小文字 → 空白除去） */
const normalizeItemName = (name) =>
  name
    .normalize('NFKC')
    .trim()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .toLowerCase()
    .replace(/\s+/g, '');

const sh = (cmd, argv) => {
  const r = spawnSync(cmd, argv, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${argv.join(' ')} → ${r.status}\n${r.stderr || r.stdout}`);
  }
  return (r.stdout || '').trim();
};

const list = ITEMS[LANG];
if (!list) throw new Error(`--lang は ja か en（received: ${LANG}）`);

// --dry-run は「アプリ未インストールでも SQL を目視できる」ことに意味があるので、
// コンテナが引けなくても止めない（撮影前の仕込み内容の下見に使う）
const container = (() => {
  try {
    return sh('xcrun', ['simctl', 'get_app_container', UDID, BUNDLE_ID, 'data']);
  } catch (e) {
    if (DRY) return '<app-container 未取得: アプリ未インストール>';
    throw e;
  }
})();
const dbPath = `${container}/Documents/SQLite/daidoko.db`;

// 期限は「翌日」= 撮影日の翌日。ローカル日付で YYYY-MM-DD。
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const pad = (n) => String(n).padStart(2, '0');
const expiresOn = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
const now = new Date().toISOString();
const epoch = Date.parse(now); // pantry-quantity.ts の epochOf(now)

const q = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

// 撮り直しを冪等にするため、この仕込みで入れた行（shot- 接頭辞）だけ消してから入れ直す
const statements = [
  'BEGIN;',
  `DELETE FROM pantry_items WHERE id LIKE 'shot-pantry-%';`,
  `DELETE FROM pantry_quantity_parts WHERE item_id LIKE 'shot-pantry-%';`,
  ...list.map(([name, soon], i) => {
    const id = `shot-pantry-${LANG}-${pad(i + 1)}`;
    // shared は null（= 共有）。quantity_base/epoch は addPantryItem と同じ形で明示する
    // （NULL で作ると起動時のベースライン化の対象に見えてしまう）
    return (
      `INSERT INTO pantry_items (id, family_id, name, name_normalized, quantity, unit, ` +
      `low_stock_threshold, jan_code, group_name, expires_on, created_at, updated_at, ` +
      `shared, quantity_base, quantity_epoch) VALUES (` +
      `${q(id)}, ${q(FAMILY_ID)}, ${q(name)}, ${q(normalizeItemName(name))}, 1, NULL, ` +
      `NULL, NULL, NULL, ${soon ? q(expiresOn) : 'NULL'}, ${q(now)}, ${q(now)}, ` +
      `NULL, 1, ${epoch});`
    );
  }),
  // 在庫が変われば献立の理由も変わる。作り直させるためキャッシュ済みプランを捨てる。
  // menu_plan_days は menu_plans の子なので **days → plan の順**（サービス層と同じ順序）
  `DELETE FROM menu_plan_days;`,
  `DELETE FROM menu_plans;`,
  'COMMIT;',
];

const sql = statements.join('\n');
if (DRY) {
  console.log(`db: ${dbPath}`);
  console.log(sql);
  process.exit(0);
}

// 書き込み中にアプリが動いていると WAL 越しに食い違う
spawnSync('xcrun', ['simctl', 'terminate', UDID, BUNDLE_ID], { encoding: 'utf8' });
sh('sqlite3', [dbPath, sql]);

const count = sh('sqlite3', [dbPath, `SELECT count(*) FROM pantry_items;`]);
console.log(`db: ${dbPath}`);
console.log(`lang=${LANG} 在庫 ${list.length} 行を投入（pantry_items 合計 ${count} 行）`);
console.log(`翌日期限: ${expiresOn}（${list.filter(([, s]) => s).length} 行）`);
