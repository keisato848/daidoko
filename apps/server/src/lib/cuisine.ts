/**
 * 料理の出自（cuisine）の推定と盛り付けの 1 行 — **`packages/shared/src/constants/cuisine.ts` の写し**。
 *
 * サーバーは実行時に `@daidoko/shared` を取り込まない方針（tsconfig の rootDir が src に
 * 閉じている = `import '@daidoko/shared'` は TS6059 で型検査を通らない）ため、語彙表と
 * 盛り付け行をここに写している。**片方だけ直さないこと** — ズレは
 * `__tests__/shared-parity.test.ts` が割れて知らせる。
 *
 * 設計: `docs/レシピ表紙AI生成設計.md` §2-1「プロンプト（C-1・2026-09-13）」。
 * 使うかどうかの栓は env `COVER_IMAGE_CUISINE_HINT`（既定 off・`cover-image.ts`）。
 */
import { nameKey as vocabKey } from './fridge-vision.js';

export const CUISINES = ['japanese', 'western', 'italian', 'chinese', 'korean'] as const;
export type Cuisine = (typeof CUISINES)[number];

/**
 * タグの語彙（**完全一致**）。タグは利用者が明示的に付けた分類なので最優先で、
 * 当たればその出自に決める（タイトル・材料は見ない）。
 */
export const CUISINE_TAG_WORDS: Record<Cuisine, readonly string[]> = {
  japanese: ['和食', '和風', '日本料理', '和', 'japanese', 'washoku'],
  western: ['洋食', '洋風', 'western'],
  italian: ['イタリアン', 'イタリア料理', 'italian'],
  chinese: ['中華', '中華料理', '中国料理', 'chinese'],
  korean: ['韓国料理', '韓国', '韓国風', 'korean'],
};

/**
 * 料理名の語彙（**部分一致**）。タグが無いレシピ（URL 取り込み・AI 生成の下書き）が
 * 多数派なので、ここが実質の主経路。短すぎる語は誤爆するので入れない
 * （「和」1 文字はタグの完全一致だけで使う）。
 */
export const CUISINE_TITLE_WORDS: Record<Cuisine, readonly string[]> = {
  japanese: [
    '味噌汁',
    'みそ汁',
    '肉じゃが',
    '筑前煮',
    '煮物',
    '煮付け',
    '照り焼き',
    'てりやき',
    '天ぷら',
    'から揚げ',
    '唐揚げ',
    '茶碗蒸し',
    'きんぴら',
    'ひじき',
    '親子丼',
    '牛丼',
    'おひたし',
    '西京焼き',
    '豚汁',
    '炊き込みご飯',
    'おにぎり',
    '寿司',
    '刺身',
    'miso soup',
    'teriyaki',
    'tempura',
    'sushi',
    'donburi',
  ],
  western: [
    'ハンバーグ',
    'シチュー',
    'グラタン',
    'ドリア',
    'ポトフ',
    'ローストビーフ',
    'ステーキ',
    'オムライス',
    'スクランブルエッグ',
    'ムニエル',
    'ポタージュ',
    'サンドイッチ',
    'ミートローフ',
    'hamburg steak',
    'stew',
    'gratin',
    'roast beef',
    'steak',
    'pot-au-feu',
    'sandwich',
  ],
  italian: [
    'パスタ',
    'スパゲッティ',
    'ペペロンチーノ',
    'カルボナーラ',
    'ボロネーゼ',
    'ミートソース',
    'ラザニア',
    'ピザ',
    'ピッツァ',
    'リゾット',
    'ニョッキ',
    'アクアパッツァ',
    'カプレーゼ',
    'ミネストローネ',
    'pasta',
    'spaghetti',
    'carbonara',
    'bolognese',
    'lasagna',
    'pizza',
    'risotto',
    'gnocchi',
    'minestrone',
  ],
  chinese: [
    '麻婆',
    'マーボー',
    '青椒肉絲',
    'チンジャオ',
    '回鍋肉',
    'ホイコーロー',
    '酢豚',
    '餃子',
    '焼売',
    'シュウマイ',
    'チャーハン',
    '炒飯',
    '春巻き',
    '棒棒鶏',
    'エビチリ',
    '担々麺',
    'ラーメン',
    '中華丼',
    'mapo',
    'gyoza',
    'dumpling',
    'fried rice',
    'sweet and sour pork',
    'ramen',
  ],
  korean: [
    'キムチ',
    'チヂミ',
    'ビビンバ',
    'プルコギ',
    'サムギョプサル',
    'ナムル',
    'スンドゥブ',
    'チゲ',
    'トッポギ',
    'ヤンニョム',
    'カルビ',
    'kimchi',
    'bibimbap',
    'bulgogi',
    'japchae',
    'tteokbokki',
  ],
};

/**
 * 材料名の語彙（**完全一致**）。タイトルにもタグにも出自が出ない料理
 * （「炒め物」「鍋」など）の最後の手がかり。**単体一致のみ** — 「醤油だれ」のような
 * 複合語は拾わない（`isCategoryName` と同じ流儀）。調味料に限る: 主材料（鶏肉・玉ねぎ）は
 * どの出自にも出るので手がかりにならない。
 */
export const CUISINE_INGREDIENT_WORDS: Record<Cuisine, readonly string[]> = {
  japanese: ['味噌', 'みそ', 'だし', '出汁', 'みりん', '白だし', 'かつお節', '昆布'],
  western: ['生クリーム', 'コンソメ', 'デミグラスソース', 'ケチャップ'],
  italian: [
    'オリーブオイル',
    'パルメザンチーズ',
    'バジル',
    'モッツァレラ',
    'トマト缶',
    'パンチェッタ',
  ],
  chinese: [
    '豆板醤',
    'テンメンジャン',
    '甜麺醤',
    'オイスターソース',
    '鶏ガラスープの素',
    '紹興酒',
    '花椒',
  ],
  korean: ['コチュジャン', '粉唐辛子', 'ダシダ'],
};

interface Matcher {
  readonly words: readonly string[];
  readonly exact: boolean;
}

function buildMatchers(
  table: Record<Cuisine, readonly string[]>,
  exact: boolean,
): Array<readonly [Cuisine, Matcher]> {
  return CUISINES.map(
    (cuisine) => [cuisine, { words: table[cuisine].map(vocabKey), exact }] as const,
  );
}

const TAG_MATCHERS = buildMatchers(CUISINE_TAG_WORDS, true);
const TITLE_MATCHERS = buildMatchers(CUISINE_TITLE_WORDS, false);
const INGREDIENT_MATCHERS = buildMatchers(CUISINE_INGREDIENT_WORDS, true);

/** 1 段ぶんの照合。当たった出自ごとの件数を返す（同点はこの関数の外で裁く）。 */
function countHits(
  matchers: Array<readonly [Cuisine, Matcher]>,
  values: readonly string[],
): Map<Cuisine, number> {
  const keys = values.map(vocabKey).filter((k) => k.length > 0);
  const hits = new Map<Cuisine, number>();
  for (const [cuisine, matcher] of matchers) {
    let n = 0;
    for (const key of keys) {
      for (const word of matcher.words) {
        if (matcher.exact ? key === word : key.includes(word)) {
          n += 1;
          break; // 1 つの値が同じ出自の語に複数当たっても 1 件
        }
      }
    }
    if (n > 0) hits.set(cuisine, n);
  }
  return hits;
}

/** 最多得点が単独ならその出自、同点・0 件なら null（＝判定不能）。 */
function winner(hits: Map<Cuisine, number>): Cuisine | null {
  let best: Cuisine | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [cuisine, count] of hits) {
    if (count > bestCount) {
      best = cuisine;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/**
 * 料理名・タグ・材料名から出自を推定する。**タグ → 料理名 → 材料名**の順に見て、
 * 先に決まった段で打ち切る（下の段は見ない）。どの段でも決まらなければ null。
 *
 * 純関数・依存ゼロ（`vocabKey` のみ）。server とモバイル（BYOK）で同じ結果になること。
 */
export function inferCuisine(
  title: string,
  tags: readonly string[] = [],
  ingredientNames: readonly string[] = [],
): Cuisine | null {
  return (
    winner(countHits(TAG_MATCHERS, tags)) ??
    winner(countHits(TITLE_MATCHERS, [title])) ??
    winner(countHits(INGREDIENT_MATCHERS, ingredientNames))
  );
}

/**
 * 出自ごとの盛り付けの 1 行。プロンプトは日本語で組み立てるが、
 * locale が en のときは英語圏の食卓を前提にした言い回しにする（現行と同じ方針）。
 */
const PLATING_LINES: Record<Cuisine, { ja: string; en: string }> = {
  japanese: {
    ja: '和食として、和食器（陶器の小鉢や漆の器）に、日本の家庭の食卓に出てくる自然な盛り付けにする。',
    en: 'Plate it as Japanese home cooking, in Japanese tableware such as a ceramic bowl or a lacquered dish.',
  },
  western: {
    ja: '洋食として、白い洋皿に、家庭の食卓に出てくる自然な盛り付けにする。',
    en: 'Plate it as Western home cooking, on a plain white plate as it would appear on a family table.',
  },
  italian: {
    ja: 'イタリア料理として、白い平皿かパスタ皿に、家庭の食卓に出てくる自然な盛り付けにする。',
    en: 'Plate it as Italian home cooking, on a white flat plate or a pasta bowl.',
  },
  chinese: {
    ja: '中華料理として、大きめの丸皿に、家庭の食卓に出てくる自然な盛り付けにする。',
    en: 'Plate it as Chinese home cooking, on a large round dish as it would appear on a family table.',
  },
  korean: {
    ja: '韓国料理として、ステンレスや陶器の器に、家庭の食卓に出てくる自然な盛り付けにする。',
    en: 'Plate it as Korean home cooking, in stainless-steel or earthenware vessels.',
  },
};

/** 出自が決まったときの盛り付け 1 行。判定不能のときは呼ばない（locale 行へフォールバック）。 */
export function platingLineFor(cuisine: Cuisine, locale: 'ja' | 'en'): string {
  return PLATING_LINES[cuisine][locale];
}
