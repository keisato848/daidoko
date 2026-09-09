/**
 * 相談画面の下書きカード（Issue #303）。
 *
 * カードがタイトルしか出していなかったので、2 回目以降の要望で中身が変わっても
 * 見た目が動かず「更新されない」に見えた。固定したいのは 4 つ:
 *
 * 1. 初回の下書きで 2 行目（人数・時間・材料数・手順数）が出て、変更行は出ない
 * 2. 置き換わった下書きで「いま変えた点: …」が出て、2 行目も追従する
 * 3. 同じ下書きが返ってきたら「前回と同じ下書きです」と正直に出す
 * 4. 質問だけの返答（draft: null）ではカードも変更行も**据え置き**（現行仕様。変えるならここを変える）
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ConsultScreen from '../consult';
import { t, tCount } from '../../../../src/i18n';
import {
  CONSULT_DRAFT_MAIN_INGREDIENT,
  CONSULT_DRAFT_OIL,
  makeConsultDraft,
} from '../../../../src/test-support/consultDraft';
import type { RecipeFormData } from '../../../../src/validation/recipe.schema';

const mockConsultRecipe = jest.fn();
const mockEnsureInferenceCredit = jest.fn(async () => 'ready' as const);
const mockRecordCloudInference = jest.fn(async () => undefined);
const mockGetInStock = jest.fn(async () => [] as string[]);
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: mockPush }),
  useLocalSearchParams: () => ({}),
}));

// ConsultError はファクトリの中で定義する。外側の class を参照すると TDZ で undefined になり
// `instanceof` の分岐が黙って死ぬ（docs/品質基準.md §2.3）
jest.mock('../../../../src/services/recipe-consult.provider', () => ({
  MAX_CONSULT_IMAGES_PER_MESSAGE: 2,
  ConsultError: class ConsultError extends Error {},
  consultRecipe: (...args: unknown[]) => mockConsultRecipe(...(args as [])),
}));

jest.mock('../../../../src/services/inference-gate.service', () => ({
  ensureInferenceCredit: (...args: unknown[]) => mockEnsureInferenceCredit(...(args as [])),
}));

jest.mock('../../../../src/services/usage.service', () => ({
  recordCloudInference: (...args: unknown[]) => mockRecordCloudInference(...(args as [])),
}));

jest.mock('../../../../src/services/pantry.service', () => ({
  UNGROUPED: '__ungrouped__',
  getPantryGroups: async () => [] as string[],
  getInStockNormalizedNames: (...args: unknown[]) => mockGetInStock(...(args as [])),
}));

jest.mock('../../../../src/services/dialog.service', () => ({
  dialog: { confirm: jest.fn(async () => false), alert: jest.fn(async () => undefined) },
}));

jest.mock('../../../../src/services/recipe.service', () => ({
  createRecipe: jest.fn(async () => 'recipe-1'),
}));

jest.mock('../../../../src/services/review-request.service', () => ({
  maybeRequestStoreReview: jest.fn(async () => undefined),
}));

jest.mock('../../../../src/services/photo-capture.service', () => ({
  capturePhotoSeries: jest.fn(async () => []),
  confirmContinueCapture: jest.fn(async () => false),
}));

jest.mock('../../../../src/services/expo-photo-capture.adapter', () => ({
  expoImagePickerPhotoCaptureAdapter: {},
}));

const SEP = t('recipeImport.consult.meta.separator');

/** カード 2 行目の期待値。画面と同じ順で辞書から組む */
function metaText(draft: RecipeFormData): string {
  const parts: string[] = [];
  if (draft.servings) parts.push(tCount('recipeImport.consult.meta.servings', draft.servings));
  if (draft.cookTimeMin) parts.push(tCount('recipeImport.consult.meta.minutes', draft.cookTimeMin));
  parts.push(tCount('recipeImport.consult.meta.ingredients', draft.ingredients.length));
  parts.push(tCount('recipeImport.consult.meta.steps', draft.steps.length));
  return parts.join(SEP);
}

/** 「いま変えた点: 」の頭。prefix の書式に依存せず「変更行が出ているか」を見る */
const CHANGE_PREFIX_HEAD = t('recipeImport.consult.change.prefix', { items: '' });
const CHANGE_NONE = t('recipeImport.consult.change.none');

const CHANGE_PREFIX_RE = new RegExp(
  `^${CHANGE_PREFIX_HEAD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
);

function changeLineShown(): boolean {
  return screen.queryAllByText(CHANGE_PREFIX_RE).length > 0;
}

/** 利用者が 1 回発言し、AI の応答（turn）が画面に反映されるまで進める。 */
async function sendTurn(
  text: string,
  turn: { reply: string; draft: RecipeFormData | null; ready: boolean },
) {
  mockConsultRecipe.mockResolvedValueOnce(turn);
  fireEvent.changeText(screen.getByPlaceholderText(t('recipeImport.consult.placeholder')), text);
  await act(async () => {
    fireEvent.press(screen.getByLabelText(t('recipeImport.consult.send')));
  });
  await waitFor(() => expect(screen.getByText(turn.reply)).toBeTruthy());
}

const first = makeConsultDraft();

describe('ConsultScreen — 下書きカードの 2 行目と「いま変えた点」（#303）', () => {
  beforeEach(() => {
    mockConsultRecipe.mockReset();
    mockEnsureInferenceCredit.mockReset().mockResolvedValue('ready');
    mockRecordCloudInference.mockReset().mockResolvedValue(undefined);
    mockGetInStock.mockReset().mockResolvedValue([]);
    mockPush.mockReset();
  });

  it('1 往復目: タイトルと 2 行目が出て、変更行は出ない', async () => {
    render(<ConsultScreen />);
    await sendTurn('鶏むね肉で何か', { reply: '下書きを作りました', draft: first, ready: false });

    expect(screen.getByText(first.title)).toBeTruthy();
    expect(screen.getByText(metaText(first))).toBeTruthy();
    // 辞書の写しでなく固定文字列でも 1 回は見る（順序と省略の仕様を固定）
    if (metaText(first).includes('人分')) {
      expect(screen.getByText('2人分 · 20分 · 材料3 · 手順3')).toBeTruthy();
    }
    expect(screen.queryByText(CHANGE_NONE)).toBeNull();
    expect(changeLineShown()).toBe(false);

    // 初回は前回の下書きが無い（null）ことをサーバーへ渡す
    expect(mockConsultRecipe).toHaveBeenCalledTimes(1);
    expect(mockConsultRecipe).toHaveBeenLastCalledWith(expect.objectContaining({ draft: null }));
    expect(mockRecordCloudInference).toHaveBeenCalledTimes(1);
  });

  it('2 往復目: 人数と分量が変わった下書き → 「いま変えた点」が出て 2 行目が追従する', async () => {
    const second = makeConsultDraft({
      servings: 4,
      ingredients: [
        { groupLabel: '', name: CONSULT_DRAFT_MAIN_INGREDIENT, amount: '2 pc', note: '' },
        { groupLabel: '', name: 'salt', amount: 'pinch', note: '' },
        { groupLabel: '', name: CONSULT_DRAFT_OIL, amount: '2 tbsp', note: '' },
      ],
    });
    render(<ConsultScreen />);
    await sendTurn('鶏むね肉で何か', { reply: '下書きを作りました', draft: first, ready: false });
    await sendTurn('4人分にして', { reply: '4人分にしました', draft: second, ready: true });

    const items = [
      tCount('recipeImport.consult.change.servings', 4),
      tCount('recipeImport.consult.change.adjusted', 2),
    ].join(SEP);
    expect(screen.getByText(t('recipeImport.consult.change.prefix', { items }))).toBeTruthy();
    expect(screen.getByText(metaText(second))).toBeTruthy();
    expect(screen.queryByText(metaText(first))).toBeNull();

    // 2 往復目は 1 往復目の下書きを前提として渡す（差分の基準はこれ）
    expect(mockConsultRecipe).toHaveBeenCalledTimes(2);
    expect(mockConsultRecipe).toHaveBeenLastCalledWith(expect.objectContaining({ draft: first }));
  });

  it('2 往復目: 同じ下書きが返ってきたら「前回と同じ下書きです」と出す', async () => {
    render(<ConsultScreen />);
    await sendTurn('鶏むね肉で何か', { reply: '下書きを作りました', draft: first, ready: false });
    // AI が「変えました」と言っても、中身で判定する
    await sendTurn('もっと簡単に', {
      reply: '簡単にしました',
      draft: makeConsultDraft(),
      ready: true,
    });

    expect(screen.getByText(CHANGE_NONE)).toBeTruthy();
    expect(screen.getByText(metaText(first))).toBeTruthy();
    expect(changeLineShown()).toBe(false);
  });

  it('変更が 5 つ以上なら 4 つまで出して「ほかN件」に畳む（料理名・追加・削除・人数外しの順）', async () => {
    // diff の並び: title → 追加 → 削除 → servings → cookTime → 手順。6 件のうち先頭 4 件だけ見せる
    const second = makeConsultDraft({
      title: 'Spicy chicken breast saute',
      servings: undefined,
      cookTimeMin: 25,
      ingredients: [
        { groupLabel: '', name: CONSULT_DRAFT_MAIN_INGREDIENT, amount: '1 pc', note: '' },
        { groupLabel: '', name: CONSULT_DRAFT_OIL, amount: '1 tbsp', note: '' },
        { groupLabel: '', name: 'garlic', amount: '2 cloves', note: '' },
      ],
      steps: [{ body: 'Sear everything together' }],
    });
    render(<ConsultScreen />);
    await sendTurn('鶏むね肉で何か', { reply: '下書きを作りました', draft: first, ready: false });
    await sendTurn('辛くして', { reply: '辛くしました', draft: second, ready: true });

    const shown = [
      t('recipeImport.consult.change.title', { title: second.title }),
      t('recipeImport.consult.change.added', { name: 'garlic' }),
      t('recipeImport.consult.change.removed', { name: 'salt' }),
      t('recipeImport.consult.change.servingsCleared'),
    ].join(SEP);
    const items = `${shown}${tCount('recipeImport.consult.change.more', 2)}`;
    expect(screen.getByText(t('recipeImport.consult.change.prefix', { items }))).toBeTruthy();
    // 2 行目: 人数が外れたので人数の欄が消え、時間・材料・手順が新しい数に
    expect(screen.getByText(metaText(second))).toBeTruthy();
  });

  it('draft: null（質問だけの返答）→ カードも変更行も据え置き', async () => {
    const second = makeConsultDraft({ servings: 4 });
    render(<ConsultScreen />);
    await sendTurn('鶏むね肉で何か', { reply: '下書きを作りました', draft: first, ready: false });
    await sendTurn('4人分にして', { reply: '4人分にしました', draft: second, ready: false });
    const changeLine = t('recipeImport.consult.change.prefix', {
      items: tCount('recipeImport.consult.change.servings', 4),
    });
    expect(screen.getByText(changeLine)).toBeTruthy();

    await sendTurn('辛くできる？', {
      reply: '辛さはどのくらいがいいですか？',
      draft: null,
      ready: false,
    });

    // 3 往復目は下書きを返していないので、2 往復目の状態がそのまま残る
    expect(screen.getByText(second.title)).toBeTruthy();
    expect(screen.getByText(metaText(second))).toBeTruthy();
    expect(screen.getByText(changeLine)).toBeTruthy();
    expect(screen.queryByText(CHANGE_NONE)).toBeNull();
    expect(mockConsultRecipe).toHaveBeenCalledTimes(3);
    expect(mockConsultRecipe).toHaveBeenLastCalledWith(expect.objectContaining({ draft: second }));
  });
});
