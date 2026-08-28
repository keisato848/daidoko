/**
 * 調理セッション（続きから再開）の不変条件。
 *
 * - ✕ で閉じる = end しない、が仕様の核。end するのは「完成」だけ
 * - 同じレシピの begin は位置を引き継ぐ（これが「再開」の実体）
 * - 復元は 12 時間以内のものだけ（昨日の調理に戻る導線は邪魔なだけ）
 */
import {
  SESSION_MAX_AGE_MS,
  loadCookingSession,
  parseSession,
  useCookingSessionStore,
} from '../cooking-session.store';

const mockGetAppMeta = jest.fn<Promise<string | null>, [string]>(async () => null);
const mockSetAppMeta = jest.fn(async () => undefined);

jest.mock('../../services/notification.service', () => ({
  presentCookingNotification: jest.fn(async () => undefined),
  dismissCookingNotification: jest.fn(async () => undefined),
}));

jest.mock('../../services/app-meta.service', () => ({
  getAppMeta: (...args: [string]) => mockGetAppMeta(...args),
  setAppMeta: (...args: [string, string]) => mockSetAppMeta(...(args as [string, string])),
}));

const BASE = { recipeId: 'r1', recipeTitle: 'カルパッチョ', totalSteps: 7 };

beforeEach(() => {
  useCookingSessionStore.setState({ session: null });
  mockGetAppMeta.mockClear();
  mockSetAppMeta.mockClear();
});

describe('cooking-session.store', () => {
  it('begin → setStep → 同じレシピの begin で位置を引き継ぐ（再開の実体）', () => {
    const store = useCookingSessionStore.getState();
    store.begin(BASE);
    store.setStep(3);

    // ✕ で閉じてもう一度開いた、に相当
    useCookingSessionStore.getState().begin(BASE);
    expect(useCookingSessionStore.getState().session?.stepIndex).toBe(3);
  });

  it('別のレシピの begin は手順 1 から（他人の位置を引き継がない）', () => {
    const store = useCookingSessionStore.getState();
    store.begin(BASE);
    store.setStep(3);

    useCookingSessionStore.getState().begin({ ...BASE, recipeId: 'r2' });
    expect(useCookingSessionStore.getState().session?.stepIndex).toBe(0);
    expect(useCookingSessionStore.getState().session?.recipeId).toBe('r2');
  });

  it('手順が減ったレシピを再開しても範囲内に丸める', () => {
    const store = useCookingSessionStore.getState();
    store.begin(BASE);
    store.setStep(6);

    // 編集で手順が 7 → 4 に減った
    useCookingSessionStore.getState().begin({ ...BASE, totalSteps: 4 });
    expect(useCookingSessionStore.getState().session?.stepIndex).toBe(3);
  });

  it('end で消え、app_meta も空にする（完成 = 復帰導線も消える）', () => {
    const store = useCookingSessionStore.getState();
    store.begin(BASE);
    useCookingSessionStore.getState().end();

    expect(useCookingSessionStore.getState().session).toBeNull();
    expect(mockSetAppMeta).toHaveBeenLastCalledWith('cooking_session', '');
  });

  it('復元: 新しいセッションは戻る', async () => {
    const saved = { ...BASE, stepIndex: 2, startedAt: Date.now() - 60_000 };
    mockGetAppMeta.mockResolvedValueOnce(JSON.stringify(saved));

    await loadCookingSession();
    expect(useCookingSessionStore.getState().session?.stepIndex).toBe(2);
  });

  it('復元: 12 時間を超えたセッションは捨てて残骸も消す', async () => {
    const stale = { ...BASE, stepIndex: 2, startedAt: Date.now() - SESSION_MAX_AGE_MS - 1000 };
    mockGetAppMeta.mockResolvedValueOnce(JSON.stringify(stale));

    await loadCookingSession();
    expect(useCookingSessionStore.getState().session).toBeNull();
    expect(mockSetAppMeta).toHaveBeenLastCalledWith('cooking_session', '');
  });

  it('復元: 壊れた JSON・欠けたフィールドは無視する', () => {
    expect(parseSession('not-json')).toBeNull();
    expect(parseSession('{"recipeId":""}')).toBeNull();
    expect(parseSession(JSON.stringify({ recipeId: 'r1' }))).toBeNull();
  });
});
