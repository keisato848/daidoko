/**
 * 紙面読み取りの正規化。
 *
 * ここで守るのは **紙面は片面だけを撮ることが普通**という前提。
 * 料理名が無くても、材料か手順が読めていれば確認画面へ進める
 * （サーバー `agents/recipe-page.agent.ts` と対の判断）。
 */
import { normalizeRecipePageRaw } from '../recipe-page.provider';

describe('normalizeRecipePageRaw', () => {
  it('読み取れた紙面を下書きにする', () => {
    const result = normalizeRecipePageRaw({
      found: true,
      title: 'アンチョビポテト',
      servings: 2,
      ingredients: [{ name: 'じゃがいも(くし形切り)', amount: '中2個(300g)' }],
      steps: [{ body: 'じゃがいもを耐熱皿に入れ、ラップをして電子レンジで加熱します。' }],
      confidence: 'high',
    });

    expect(result?.confidence).toBe('high');
    expect(result?.draft.title).toBe('アンチョビポテト');
    expect(result?.draft.servings).toBe(2);
    expect(result?.draft.ingredients).toEqual([
      { name: 'じゃがいも(くし形切り)', amount: '中2個(300g)', groupLabel: '', note: '' },
    ]);
  });

  it('料理名が無くても、手順が読めていれば通す（裏面だけを撮った場合）', () => {
    const result = normalizeRecipePageRaw({
      found: true,
      steps: [{ body: '油を熱し、焼き目が付くまで炒めます。' }],
      confidence: 'medium',
    });

    expect(result).not.toBeNull();
    expect(result?.draft.title).toBe('');
    expect(result?.draft.steps).toHaveLength(1);
    // 編集用に空の材料行を 1 つ置く
    expect(result?.draft.ingredients).toHaveLength(1);
    expect(result?.draft.ingredients[0].name).toBe('');
  });

  it('材料も手順も無ければ通さない（見出しだけの下書きを作らない）', () => {
    expect(
      normalizeRecipePageRaw({
        found: true,
        title: 'アンチョビポテト',
        ingredients: [],
        steps: [],
      }),
    ).toBeNull();
  });

  it('found=false は通さない', () => {
    expect(normalizeRecipePageRaw({ found: false, rejectReason: 'no_recipe' })).toBeNull();
  });

  it('保存スキーマの上限に刈り込む', () => {
    const long = 'あ'.repeat(600);
    const result = normalizeRecipePageRaw({
      found: true,
      title: long,
      servings: 300,
      cookTimeMin: 5000,
      ingredients: [{ name: long, amount: long, note: long, groupLabel: long }],
      steps: [{ body: long }],
    });

    expect(result?.draft.title).toHaveLength(100);
    expect(result?.draft.ingredients[0].name).toHaveLength(50);
    expect(result?.draft.ingredients[0].amount).toHaveLength(30);
    expect(result?.draft.ingredients[0].groupLabel).toHaveLength(30);
    expect(result?.draft.ingredients[0].note).toHaveLength(100);
    expect(result?.draft.steps[0].body).toHaveLength(500);
    // 範囲外は「読めなかった」扱い
    expect(result?.draft.servings).toBeUndefined();
    expect(result?.draft.cookTimeMin).toBeUndefined();
  });

  it('名前の無い材料行は落とす（分量だけの行を材料にしない）', () => {
    const result = normalizeRecipePageRaw({
      found: true,
      ingredients: [{ name: '塩', amount: '少々' }, { amount: '大さじ1' }],
      steps: [{ body: '炒める' }],
    });

    expect(result?.draft.ingredients).toEqual([
      { name: '塩', amount: '少々', groupLabel: '', note: '' },
    ]);
  });
});
