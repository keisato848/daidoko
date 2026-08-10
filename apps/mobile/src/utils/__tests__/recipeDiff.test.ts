import { diffRecipes, onlyChanged } from '../recipeDiff';
import type { RecipeFormData } from '../../validation/recipe.schema';
import { setLocale, SUPPORTED_LOCALES, t } from '../../i18n';

function recipe(overrides: Partial<RecipeFormData> = {}): RecipeFormData {
  return {
    title: '麻婆豆腐',
    titleReading: '',
    description: '',
    servings: 2,
    cookTimeMin: 25,
    ingredients: [
      { groupLabel: '主材料', name: '木綿豆腐', amount: '1丁', note: '' },
      { groupLabel: '調味料', name: '甜麺醤', amount: '大さじ2', note: '' },
    ],
    steps: [{ body: '豆腐を切る' }, { body: '炒めて煮る' }],
    tags: ['中華'],
    ...overrides,
  };
}

describe('diffRecipes', () => {
  it('変更がなければ hasChanges=false', () => {
    const diff = diffRecipes(recipe(), recipe());
    expect(diff.hasChanges).toBe(false);
    expect(diff.changeCount).toBe(0);
  });

  it('分量が変わった材料だけ changed になる', () => {
    const after = recipe({
      ingredients: [
        { groupLabel: '主材料', name: '木綿豆腐', amount: '1丁', note: '' },
        { groupLabel: '調味料', name: '甜麺醤', amount: '大さじ1', note: '' },
      ],
    });
    const diff = diffRecipes(recipe(), after);

    expect(diff.changeCount).toBe(1);
    const changed = onlyChanged(diff.ingredients);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      kind: 'changed',
      label: '甜麺醤',
      before: '大さじ2',
      after: '大さじ1',
    });
    // 指示していない材料は unchanged のまま（Issue #113 の完了条件）
    expect(diff.ingredients.find((row) => row.label === '木綿豆腐')?.kind).toBe('unchanged');
  });

  it('材料の追加・削除が分かる', () => {
    const after = recipe({
      ingredients: [
        { groupLabel: '主材料', name: '木綿豆腐', amount: '1丁', note: '' },
        { groupLabel: '調味料', name: '黒酢', amount: '小さじ1', note: '' },
      ],
    });
    const diff = diffRecipes(recipe(), after);
    const rows = onlyChanged(diff.ingredients);

    expect(rows).toContainEqual(expect.objectContaining({ kind: 'removed', label: '甜麺醤' }));
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'added', label: '黒酢' }));
  });

  // 実機のガレットのレシピで発生: 卵が「生地用」と「目玉焼き用」の2つ、塩が2つあり、
  // 名前だけで突き合わせると別物どうしを比べて「変更」に見えていた
  it('同名の材料が複数あってもグループで区別する', () => {
    const withDuplicates = (eggAmount: string): RecipeFormData =>
      recipe({
        ingredients: [
          { groupLabel: '生地', name: '卵', amount: '1個', note: '' },
          { groupLabel: '具材', name: '卵', amount: eggAmount, note: '' },
        ],
      });

    // 具材の卵だけ変えた → 生地の卵は unchanged のまま
    const diff = diffRecipes(withDuplicates('1個'), withDuplicates('2個'));
    const changed = onlyChanged(diff.ingredients);

    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ before: '1個', after: '2個' });
    expect(diff.ingredients.filter((row) => row.kind === 'unchanged')).toHaveLength(1);
  });

  it('材料の並び替えだけでは変更にならない（名前で対応づける）', () => {
    const after = recipe({
      ingredients: [
        { groupLabel: '調味料', name: '甜麺醤', amount: '大さじ2', note: '' },
        { groupLabel: '主材料', name: '木綿豆腐', amount: '1丁', note: '' },
      ],
    });
    expect(diffRecipes(recipe(), after).hasChanges).toBe(false);
  });

  it('note の追加も変更として見える（「推定」などが増えたら知らせる）', () => {
    const after = recipe({
      ingredients: [
        { groupLabel: '主材料', name: '木綿豆腐', amount: '1丁', note: '' },
        { groupLabel: '調味料', name: '甜麺醤', amount: '大さじ2', note: '推定' },
      ],
    });
    const rows = onlyChanged(diffRecipes(recipe(), after).ingredients);
    expect(rows[0]).toMatchObject({ kind: 'changed', after: '大さじ2（推定）' });
  });

  it('手順は位置で対応づける', () => {
    const after = recipe({ steps: [{ body: '豆腐を切る' }, { body: '弱火で5分煮る' }] });
    const diff = diffRecipes(recipe(), after);
    const rows = onlyChanged(diff.steps);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'changed',
      label: t('recipe.revisions.stepLabel', { number: 2 }),
      after: '弱火で5分煮る',
    });
  });

  it('手順が増えたら added', () => {
    const after = recipe({
      steps: [{ body: '豆腐を切る' }, { body: '炒めて煮る' }, { body: '花椒をふる' }],
    });
    const rows = onlyChanged(diffRecipes(recipe(), after).steps);
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'added',
        label: t('recipe.revisions.stepLabel', { number: 3 }),
      }),
    ]);
  });

  it('料理名・人数・時間の変更は meta に出る', () => {
    const after = recipe({ title: '麻婆茄子', servings: 4 });
    const diff = diffRecipes(recipe(), after);

    expect(diff.meta).toContainEqual(
      expect.objectContaining({
        label: t('recipe.revisions.metaTitle'),
        before: '麻婆豆腐',
        after: '麻婆茄子',
      }),
    );
    expect(diff.meta).toContainEqual(
      expect.objectContaining({ label: t('common.servings'), before: '2', after: '4' }),
    );
  });

  /**
   * 差分の見出しは**ロケールで変わる**。日本語のまま英語画面に出ていないか、
   * どのロケールでも見出しが空になっていないかを確かめる。
   */
  describe.each(SUPPORTED_LOCALES)('%s: 見出しがロケールに追従する', (locale) => {
    beforeEach(() => setLocale(locale));
    afterEach(() => setLocale('ja'));

    it('meta と steps の見出しが空でなく、en では日本語を含まない', () => {
      const diff = diffRecipes(recipe(), recipe({ title: '麻婆茄子', servings: 4 }));
      const labels = [
        ...diff.meta.map((row) => row.label),
        t('recipe.revisions.stepLabel', { number: 1 }),
      ];
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        expect(label.trim()).not.toBe('');
        if (locale === 'en') expect(label).not.toMatch(/[ぁ-んァ-ヶ一-龯]/);
      }
    });
  });
});
