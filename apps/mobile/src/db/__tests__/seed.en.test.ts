/**
 * 英語サンプルデータの網羅性・構造保存の検査。
 *
 * seed.ts にレシピや材料を足したのに seed.en.ts を足し忘れると、英語表示の
 * ビルドに日本語が混ざる（ストア掲載のスクリーンショットに出てしまう）。
 * ここで「日本語が残っていないこと」と「構造が変わっていないこと」を機械で止める。
 */
import { buildEnglishSeed } from '../seed.en';
import {
  seedCookingLogs,
  seedIngredients,
  seedRecipes,
  seedRevisions,
  seedShoppingItems,
  seedSteps,
  seedTags,
  seedUsers,
} from '../seed';
import { normalizeItemName } from '../../utils/itemName';

const JAPANESE = /[぀-ゟ゠-ヿ一-鿿]/;

const english = buildEnglishSeed();

describe('buildEnglishSeed — 網羅性', () => {
  it('表示される文字列に日本語が残っていない', () => {
    const displayed: { where: string; text: string | null }[] = [
      ...english.users.map((u) => ({ where: `user ${u.id}`, text: u.displayName })),
      ...english.families.map((f) => ({ where: `family ${f.id}`, text: f.name })),
      ...english.recipes.map((r) => ({ where: `recipe ${r.id}`, text: r.title })),
      ...english.revisions.map((r) => ({ where: `revision ${r.id}`, text: r.description })),
      ...english.ingredients.flatMap((i) => [
        { where: `ingredient ${i.id} name`, text: i.name },
        { where: `ingredient ${i.id} amount`, text: i.amount },
        { where: `ingredient ${i.id} group`, text: i.groupLabel },
      ]),
      ...english.steps.map((s) => ({ where: `step ${s.id}`, text: s.body })),
      ...english.tags.map((t) => ({ where: `tag ${t.id}`, text: t.name })),
      ...english.cookingLogs.map((l) => ({ where: `log ${l.id}`, text: l.memo })),
      ...english.shoppingItems.flatMap((s) => [
        { where: `shopping ${s.id} name`, text: s.name },
        { where: `shopping ${s.id} amount`, text: s.amount },
      ]),
    ];

    const untranslated = displayed
      .filter((entry) => entry.text !== null && JAPANESE.test(entry.text))
      .map((entry) => `${entry.where}: ${entry.text ?? ''}`);

    expect(untranslated).toEqual([]);
  });

  it('日本語版で文言のある項目は英語版でも空にならない', () => {
    const emptied = [
      ...english.recipes.filter((r) => r.title.trim() === '').map((r) => `recipe ${r.id}`),
      ...english.steps.filter((s) => s.body.trim() === '').map((s) => `step ${s.id}`),
      ...english.ingredients.filter((i) => i.name.trim() === '').map((i) => `ingredient ${i.id}`),
    ];
    expect(emptied).toEqual([]);
  });
});

describe('buildEnglishSeed — 構造の保存', () => {
  it('件数と ID の並びが日本語版と同じ', () => {
    expect(english.users.map((x) => x.id)).toEqual(seedUsers.map((x) => x.id));
    expect(english.recipes.map((x) => x.id)).toEqual(seedRecipes.map((x) => x.id));
    expect(english.revisions.map((x) => x.id)).toEqual(seedRevisions.map((x) => x.id));
    expect(english.ingredients.map((x) => x.id)).toEqual(seedIngredients.map((x) => x.id));
    expect(english.steps.map((x) => x.id)).toEqual(seedSteps.map((x) => x.id));
    expect(english.tags.map((x) => x.id)).toEqual(seedTags.map((x) => x.id));
    expect(english.cookingLogs.map((x) => x.id)).toEqual(seedCookingLogs.map((x) => x.id));
    expect(english.shoppingItems.map((x) => x.id)).toEqual(seedShoppingItems.map((x) => x.id));
  });

  it('材料のグループ見出しの有無を変えない（並びが変わってしまうため）', () => {
    const before = seedIngredients.map((i) => i.groupLabel !== null);
    const after = english.ingredients.map((i) => i.groupLabel !== null);
    expect(after).toEqual(before);
  });

  it('タイマー秒数と分量の数値まわりを勝手に変えない', () => {
    expect(english.steps.map((s) => s.timerSec)).toEqual(seedSteps.map((s) => s.timerSec));
    expect(english.revisions.map((r) => r.servings)).toEqual(seedRevisions.map((r) => r.servings));
    expect(english.revisions.map((r) => r.cookTimeMin)).toEqual(
      seedRevisions.map((r) => r.cookTimeMin),
    );
  });

  it('買い物リストの正規化名を英語名から作り直している', () => {
    for (const item of english.shoppingItems) {
      expect(item.nameNormalized).toBe(normalizeItemName(item.name));
    }
  });

  it('メモの無い調理記録は英語版でも null のまま', () => {
    const withoutMemo = seedCookingLogs.filter((l) => l.memo === null).map((l) => l.id);
    for (const id of withoutMemo) {
      expect(english.cookingLogs.find((l) => l.id === id)?.memo).toBeNull();
    }
  });
});
