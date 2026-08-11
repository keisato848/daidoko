/**
 * Play 掲載のある言語を一覧する（読み取りのみ・edit は commit しない）。
 *
 * 多言語化のときに「英語の掲載がもう在るのか」「何が入っているのか」を
 * 確かめるために使う。**commit しないので Play 側は一切変わらない。**
 *
 * 使い方: node scripts/release/list-play-listings.mjs
 */
import { createEditsClient, getAccessToken } from './lib/play-api.mjs';

const token = await getAccessToken();
const client = createEditsClient(token);
const edit = await client.insert();

const { listings = [] } = await client.listListings(edit.id);

if (listings.length === 0) {
  process.stdout.write('掲載なし\n');
} else {
  process.stdout.write(`掲載のある言語: ${listings.length} 件\n\n`);
  for (const listing of listings) {
    process.stdout.write(`■ ${listing.language}\n`);
    process.stdout.write(`  タイトル: ${listing.title ?? '(なし)'}\n`);
    process.stdout.write(`  短い説明: ${(listing.shortDescription ?? '').slice(0, 60)}\n`);
    process.stdout.write(`  詳しい説明: ${(listing.fullDescription ?? '').length} 字\n`);
    process.stdout.write(`  動画: ${listing.video || '(なし)'}\n\n`);
  }
}

// **commit しない。** edit は放置すれば期限切れで破棄される。
process.stdout.write(`(edit ${edit.id} は commit していないので Play 側は変わっていない)\n`);
