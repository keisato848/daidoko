/**
 * 英語表示のときに使うサンプルデータの文言。
 *
 * サンプルデータ（seed.ts）は日本語で書かれているので、UI だけ英語にしても
 * 画面には日本語のレシピ名・材料・手順が並んでしまう。**ストア掲載の
 * スクリーンショットがそれでは英語圏の利用者に通じない**ため、ID と構造は
 * そのままに表示テキストだけ差し替える。
 *
 * ここで差し替えるのは見える文字だけ。ID・並び順・数量の単位換算・タイマー秒数は
 * 変えない（換算するとレシピとして別物になり、比較もできなくなる）。
 *
 * 適用は migrate.ts の seedDatabase()。ロケールが en のときだけ効く。
 */
import { normalizeItemName } from '../utils/itemName';

import {
  seedCookingLogs,
  seedFamilies,
  seedIngredients,
  seedRecipes,
  seedRevisions,
  seedShoppingItems,
  seedSteps,
  seedTags,
  seedUsers,
} from './seed';

// ─── 表示テキスト（id → 英語） ───────────────────────────────────────────────

const USER_NAMES: Readonly<Record<string, string>> = {
  'user-kei': 'Kei',
  'user-ken': 'Ken',
  'user-yo': 'Yo',
};

const FAMILY_NAMES: Readonly<Record<string, string>> = {
  'family-001': 'The Sato Family Kitchen',
};

/** 一覧の行に収まる長さにする（長い注釈つきの訳は折り返して読みにくい）。 */
const RECIPE_TITLES: Readonly<Record<string, string>> = {
  'recipe-1': 'Nikujaga (Beef & Potato Stew)',
  'recipe-2': 'Miso Soup',
  'recipe-3': 'Karaage Fried Chicken',
  'recipe-4': 'Takikomi Gohan (Mixed Rice)',
  'recipe-5': 'Tonjiru Pork Miso Soup',
  'recipe-6': 'Hamburg Steak',
  'recipe-7': 'Creamy Scrambled Egg Toast',
};

const REVISION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'rev-1': 'A home-cooking staple — soft potatoes that have soaked up all the flavour.',
  'rev-2': 'The taste of home you want every single day.',
  'rev-3': 'Crisp outside, juicy inside. The trick is a good long marinade.',
  'rev-4': 'Rice cooked with everything autumn has to offer.',
  'rev-5': 'A warming pork and vegetable soup — a winter staple.',
  'rev-6': 'Plump, juicy patties with a sauce made from scratch.',
  'rev-7':
    'Scrambled eggs made soft with butter and milk, piled onto crisp toast. Breakfast like you are away somewhere.',
};

/**
 * 材料は名前・分量・グループ見出しの組。分量は換算せず、単位の言い回しだけ英語にする
 * （換算するとレシピが別物になり、日本語版と比べられなくなる）。
 * group は元データが groupLabel を持つ材料にだけ付ける。
 */
const INGREDIENTS: Readonly<Record<string, { name: string; amount: string; group?: string }>> = {
  // Nikujaga
  'ing-1-01': { name: 'Potatoes (waxy)', amount: '3' },
  'ing-1-02': { name: 'Onion', amount: '1' },
  'ing-1-03': { name: 'Thinly sliced beef', amount: '200g' },
  'ing-1-04': { name: 'Carrot', amount: '1/2' },
  'ing-1-05': { name: 'Soy sauce', amount: '3 tbsp', group: 'A · Seasonings' },
  'ing-1-06': { name: 'Mirin', amount: '3 tbsp', group: 'A · Seasonings' },
  'ing-1-07': { name: 'Sugar', amount: '2 tbsp', group: 'A · Seasonings' },
  'ing-1-08': { name: 'Dashi stock', amount: '300ml', group: 'A · Seasonings' },
  // Miso soup
  'ing-2-01': { name: 'Tofu', amount: '1/2 block' },
  'ing-2-02': { name: 'Wakame seaweed', amount: 'as needed' },
  'ing-2-03': { name: 'Onion', amount: '1/2' },
  'ing-2-04': { name: 'Miso', amount: '2 tbsp', group: 'A · Seasonings' },
  'ing-2-05': { name: 'Dashi stock', amount: '600ml', group: 'A · Seasonings' },
  // Karaage
  'ing-3-01': { name: 'Chicken thigh', amount: '500g' },
  'ing-3-02': { name: 'Soy sauce', amount: '2 tbsp', group: 'A · Marinade' },
  'ing-3-03': { name: 'Garlic', amount: '2 cloves', group: 'A · Marinade' },
  'ing-3-04': { name: 'Ginger', amount: '1 knob', group: 'A · Marinade' },
  'ing-3-05': { name: 'Sake', amount: '1 tbsp', group: 'A · Marinade' },
  'ing-3-06': { name: 'Potato starch', amount: 'as needed', group: 'B · Coating' },
  'ing-3-07': { name: 'Plain flour', amount: 'as needed', group: 'B · Coating' },
  // Takikomi gohan
  'ing-4-01': { name: 'Rice', amount: '2 cups' },
  'ing-4-02': { name: 'Chicken thigh', amount: '150g' },
  'ing-4-03': { name: 'Carrot', amount: '1/2' },
  'ing-4-04': { name: 'Burdock root', amount: '1/2' },
  'ing-4-05': { name: 'Fried tofu (aburaage)', amount: '1 sheet' },
  'ing-4-06': { name: 'Soy sauce', amount: '2 tbsp', group: 'A · Seasonings' },
  'ing-4-07': { name: 'Mirin', amount: '2 tbsp', group: 'A · Seasonings' },
  'ing-4-08': { name: 'Sake', amount: '1 tbsp', group: 'A · Seasonings' },
  // Tonjiru
  'ing-5-01': { name: 'Pork belly', amount: '150g' },
  'ing-5-02': { name: 'Daikon radish', amount: '1/4' },
  'ing-5-03': { name: 'Carrot', amount: '1/2' },
  'ing-5-04': { name: 'Potatoes', amount: '2' },
  'ing-5-05': { name: 'Onion', amount: '1' },
  'ing-5-06': { name: 'Burdock root', amount: '1/2' },
  'ing-5-07': { name: 'Miso', amount: '3 tbsp', group: 'A · Seasonings' },
  'ing-5-08': { name: 'Dashi stock', amount: '800ml', group: 'A · Seasonings' },
  // Hamburg steak
  'ing-6-01': { name: 'Minced beef and pork', amount: '300g' },
  'ing-6-02': { name: 'Onion', amount: '1/2' },
  'ing-6-03': { name: 'Egg', amount: '1' },
  'ing-6-04': { name: 'Breadcrumbs', amount: '3 tbsp' },
  'ing-6-05': { name: 'Milk', amount: '2 tbsp' },
  'ing-6-06': { name: 'Worcestershire sauce', amount: '2 tbsp', group: 'A · Sauce' },
  'ing-6-07': { name: 'Ketchup', amount: '2 tbsp', group: 'A · Sauce' },
  // Scrambled egg toast
  'ing-7-01': { name: 'Eggs', amount: '2' },
  'ing-7-02': { name: 'Milk', amount: '1 tbsp' },
  'ing-7-03': { name: 'Butter', amount: '10g' },
  'ing-7-04': { name: 'Sliced bread', amount: '1 slice' },
  'ing-7-05': { name: 'Ham or bacon', amount: '2 slices' },
  'ing-7-06': { name: 'Salt', amount: 'a pinch', group: 'Seasonings' },
  'ing-7-07': { name: 'Pepper', amount: 'a pinch', group: 'Seasonings' },
  'ing-7-08': { name: 'Sprouts or watercress', amount: 'a little', group: 'Optional' },
};

const STEPS: Readonly<Record<string, string>> = {
  // Nikujaga
  'step-1-01': 'Peel the potatoes and cut into bite-size pieces. Soak in water to draw out starch.',
  'step-1-02': 'Cut the onion into wedges and the carrot into irregular chunks.',
  'step-1-03':
    'Heat oil in a pot and fry the beef. Once the colour changes, add the vegetables and keep frying.',
  'step-1-04':
    'Add the A seasonings and the dashi, cover with a drop lid and simmer over medium heat.',
  'step-1-05': 'It is done when a skewer slides straight through a potato. Serve into bowls.',
  // Miso soup
  'step-2-01': 'Pour the dashi into a pot and put it on the heat.',
  'step-2-02': 'Slice the onion thinly, add it to the pot and simmer until soft.',
  'step-2-03': 'Dice the tofu and add it, along with the wakame.',
  'step-2-04': 'Lower the heat and dissolve in the miso. Take it off before it boils.',
  // Karaage
  'step-3-01': 'Cut the chicken thigh into bite-size pieces.',
  'step-3-02': 'Combine the A marinade ingredients and leave the chicken to soak in it.',
  'step-3-03': 'Mix the potato starch with the flour and coat the chicken.',
  'step-3-04': 'Fry at 170°C for 3–4 minutes. Lift it out and rest it for 2 minutes.',
  'step-3-05': 'Raise the oil to 190°C and fry for 1 more minute until crisp.',
  // Takikomi gohan
  'step-4-01': 'Rinse the rice and let it soak for 30 minutes.',
  'step-4-02':
    'Cut the chicken small. Julienne the carrot and burdock, and slice the fried tofu into strips.',
  'step-4-03':
    'Put the rice and the A seasonings in the rice cooker, then add water up to the 2-cup line.',
  'step-4-04': 'Lay the other ingredients on top of the rice without stirring, and start cooking.',
  'step-4-05': 'When it is done, fold everything through lightly and serve.',
  // Tonjiru
  'step-5-01':
    'Cut all the vegetables into easy-to-eat pieces, and the pork into bite-size pieces.',
  'step-5-02': 'Heat sesame oil in a pot and fry the pork. Add the vegetables and keep frying.',
  'step-5-03': 'Add the dashi and simmer until the vegetables are soft, skimming off any foam.',
  'step-5-04': 'Lower the heat, dissolve in the miso, and it is ready.',
  // Hamburg steak
  'step-6-01': 'Finely chop the onion, fry it in butter until translucent, then let it cool.',
  'step-6-02':
    'Knead the mince, the fried onion, egg, breadcrumbs and milk together well in a bowl.',
  'step-6-03': 'Divide into four and shape into ovals. Press a dip into the centre of each.',
  'step-6-04':
    'Heat a frying pan over medium heat and brown both sides. Cover and steam over low heat for 5 minutes.',
  'step-6-05': 'Combine the A sauce ingredients, reduce them in the pan and pour over the patties.',
  // Scrambled egg toast
  'step-7-01': 'Beat the eggs, milk, salt and pepper together in a bowl. Toast the bread.',
  'step-7-02':
    'Melt the butter in a pan and pour in the egg. Stir in large folds over low heat until just set.',
  'step-7-03': 'Sear the ham (or bacon) quickly.',
  'step-7-04':
    'Pile the scrambled egg onto the toast, add the ham, and finish with sprouts if you like.',
};

const TAGS: Readonly<Record<string, string>> = {
  'tag-01': 'Meat',
  'tag-02': 'Simmered',
  'tag-03': 'Staple',
  'tag-04': 'Soup',
  'tag-05': 'Fried',
  'tag-06': 'Rice',
  'tag-07': 'Autumn',
  'tag-08': 'Winter',
  'tag-09': 'Western',
};

const LOG_MEMOS: Readonly<Record<string, string>> = {
  'log-1': 'Used extra dashi. Same again next time.',
  'log-3': 'Went heavy on the garlic — a big hit!',
};

/** 買い物リストは recipe-1 の材料から作られたもの。材料側の訳と揃える。 */
const SHOPPING_ITEM_SOURCE_IDS: Readonly<Record<string, string>> = {
  'shop-01': 'ing-1-01',
  'shop-02': 'ing-1-02',
  'shop-03': 'ing-1-03',
  'shop-04': 'ing-1-04',
  'shop-05': 'ing-1-05',
  'shop-06': 'ing-1-06',
  'shop-07': 'ing-1-07',
  'shop-08': 'ing-1-08',
};

// ─── 適用 ────────────────────────────────────────────────────────────────────

/**
 * 英語表示用に文言だけ差し替えたサンプルデータを返す。
 * 訳の無い ID は元の値のまま（差し替え漏れがあっても壊れない）。
 */
export function buildEnglishSeed() {
  return {
    users: seedUsers.map((user) => ({
      ...user,
      displayName: USER_NAMES[user.id] ?? user.displayName,
    })),
    families: seedFamilies.map((family) => ({
      ...family,
      name: FAMILY_NAMES[family.id] ?? family.name,
    })),
    recipes: seedRecipes.map((recipe) => {
      const title = RECIPE_TITLES[recipe.id];
      // titleReading は日本語検索用のかな。英語名には対応する読みが無いので
      // 小文字化したタイトルを入れておく（検索の正規化と噛み合う）。
      return title === undefined
        ? { ...recipe }
        : { ...recipe, title, titleReading: title.toLowerCase() };
    }),
    revisions: seedRevisions.map((revision) => ({
      ...revision,
      description: REVISION_DESCRIPTIONS[revision.id] ?? revision.description,
    })),
    ingredients: seedIngredients.map((ingredient) => {
      const translated = INGREDIENTS[ingredient.id];
      if (translated === undefined) return { ...ingredient };
      return {
        ...ingredient,
        name: translated.name,
        amount: translated.amount,
        // 元データに見出しが無い材料へ見出しを生やさない（並びが変わってしまう）。
        groupLabel: ingredient.groupLabel === null ? null : (translated.group ?? null),
      };
    }),
    steps: seedSteps.map((step) => ({ ...step, body: STEPS[step.id] ?? step.body })),
    tags: seedTags.map((tag) => ({ ...tag, name: TAGS[tag.id] ?? tag.name })),
    cookingLogs: seedCookingLogs.map((log) => ({
      ...log,
      memo: LOG_MEMOS[log.id] ?? log.memo,
    })),
    shoppingItems: seedShoppingItems.map((item) => {
      const sourceId = SHOPPING_ITEM_SOURCE_IDS[item.id];
      const translated = sourceId === undefined ? undefined : INGREDIENTS[sourceId];
      if (translated === undefined) return { ...item };
      return {
        ...item,
        name: translated.name,
        // 正規化名は名前から必ず作り直す（検索・名寄せがこの列を見る）。
        nameNormalized: normalizeItemName(translated.name),
        amount: translated.amount,
      };
    }),
  };
}
