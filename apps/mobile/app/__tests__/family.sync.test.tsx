/**
 * 家族画面のクラウド共有セクション（同期 S0）。
 *
 * 固定したいこと:
 * - 未参加: 「何が共有されるか」の説明と、作成・参加の入口が出る
 * - 参加中（オーナー）: 招待コード・再発行・グループ削除が出る
 * - 参加中（メンバー）: 招待コードとグループ削除は**出ない**（離脱だけ）
 * - 同期の無い環境: 準備中の文言だけ（生のエラーを出さない）
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import FamilyScreen from '../family';
import { t } from '../../src/i18n';

const mockGetSyncState = jest.fn();
const mockFetchSyncMe = jest.fn();
const mockJoinSyncGroup = jest.fn();
const mockSetParams = jest.fn();
const mockDialogConfirm = jest.fn();
const mockDialogAlert = jest.fn();
// 招待リンク（app/j/[code].tsx）から来たときの ?invite=。各テストで差し替える
let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: jest.fn(),
    push: jest.fn(),
    canGoBack: () => false,
    setParams: (...args: unknown[]) => {
      mockSetParams(...args);
      mockSearchParams = {}; // 本物と同じく、消したら次の描画から空になる
    },
  }),
  useLocalSearchParams: () => mockSearchParams,
  // ヘッダの「＜」（HeaderBackButton）が戻り先ラベルを引くのに使う。
  // 履歴なし（= ラベル無しの「＜」だけ）として描画する
  useNavigation: () => ({ getState: () => ({ index: 0, routes: [] }) }),
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
}));

jest.mock('../../src/services/sync-client.service', () => {
  class SyncError extends Error {
    code: string;
    constructor(mockCode: string) {
      super(`sync: ${mockCode}`);
      this.name = 'SyncError';
      this.code = mockCode;
    }
  }
  return {
    SyncError,
    getSyncState: (...args: unknown[]) => mockGetSyncState(...args),
    fetchSyncMe: (...args: unknown[]) => mockFetchSyncMe(...args),
    createSyncGroup: jest.fn(),
    joinSyncGroup: (...args: unknown[]) => mockJoinSyncGroup(...args),
    inviteLinkUrl: (code: string) => `https://example.test/j/${code}`,
    rotateSyncInvite: jest.fn(),
    leaveSyncGroup: jest.fn(),
    deleteSyncGroup: jest.fn(),
  };
});

jest.mock('../../src/services/dialog.service', () => ({
  dialog: {
    alert: (...args: unknown[]) => mockDialogAlert(...args),
    confirm: (...args: unknown[]) => mockDialogConfirm(...args),
    choose: jest.fn(),
  },
}));

jest.mock('../../src/services/sync-runner.service', () => ({
  onSyncGroupJoined: jest.fn(async () => undefined),
  onSyncGroupLeft: jest.fn(async () => undefined),
}));

jest.mock('../../src/services/user.service', () => ({
  getCurrentFamily: () => ({
    id: 'family-001',
    name: 'テスト家',
    inviteCode: 'DK0001',
    ownerId: 'user-kei',
    memberCount: 1,
  }),
  getCurrentUser: () => ({ id: 'user-kei', displayName: 'けい' }),
  getCurrentUserProfile: async () => ({ id: 'user-kei', displayName: 'けい' }),
  getCurrentFamilyProfile: async () => ({
    id: 'family-001',
    name: 'テスト家',
    inviteCode: 'DK0001',
    ownerId: 'user-kei',
    memberCount: 1,
  }),
  getFamilyMembers: async () => [],
  addFamilyMember: jest.fn(),
  removeFamilyMember: jest.fn(),
  updateCurrentFamilyName: jest.fn(),
  updateCurrentUserDisplayName: jest.fn(),
}));

const ME_OWNER = {
  groupId: 'g1',
  deviceId: 'd1',
  isOwner: true,
  memberCount: 2,
  inviteCode: 'ABCD2345',
  inviteExpiresAt: '2026-08-22T09:00:00.000Z',
};

describe('FamilyScreen — クラウド共有', () => {
  beforeEach(() => {
    mockGetSyncState.mockReset();
    mockFetchSyncMe.mockReset();
    mockJoinSyncGroup.mockReset();
    mockSetParams.mockReset();
    mockDialogConfirm.mockReset();
    mockDialogAlert.mockReset();
    mockSearchParams = {};
  });

  it('未参加: 説明・作成ボタン・招待コード入力が出る', async () => {
    mockGetSyncState.mockResolvedValue({ kind: 'none' });
    render(<FamilyScreen />);

    await waitFor(() => expect(screen.getByText(t('family.sync.create'))).toBeTruthy());
    expect(screen.getByText(t('family.sync.introNone'))).toBeTruthy();
    expect(screen.getByPlaceholderText(t('family.sync.joinPlaceholder'))).toBeTruthy();
  });

  it('参加中（オーナー）: 招待コード・期限・再発行・グループ削除が出る', async () => {
    mockGetSyncState.mockResolvedValue({
      kind: 'joined',
      credentials: { groupId: 'g1', deviceId: 'd1', deviceSecret: 's' },
    });
    mockFetchSyncMe.mockResolvedValue(ME_OWNER);
    render(<FamilyScreen />);

    await waitFor(() => expect(screen.getByText('ABCD2345')).toBeTruthy());
    expect(screen.getByText(t('family.sync.deleteGroup'))).toBeTruthy();
    expect(screen.getByText(t('family.sync.leave'))).toBeTruthy();
    expect(screen.getByText(t('family.rotate'))).toBeTruthy();
  });

  it('参加中（メンバー）: 招待コードとグループ削除は出ない（離脱だけ）', async () => {
    mockGetSyncState.mockResolvedValue({
      kind: 'joined',
      credentials: { groupId: 'g1', deviceId: 'd2', deviceSecret: 's' },
    });
    mockFetchSyncMe.mockResolvedValue({
      groupId: 'g1',
      deviceId: 'd2',
      isOwner: false,
      memberCount: 2,
    });
    render(<FamilyScreen />);

    await waitFor(() => expect(screen.getByText(t('family.sync.leave'))).toBeTruthy());
    expect(screen.queryByText(t('family.sync.deleteGroup'))).toBeNull();
    expect(screen.queryByText(t('family.sync.inviteLabel'))).toBeNull();
  });

  it('同期の無い環境: 準備中の文言だけ出す', async () => {
    mockGetSyncState.mockResolvedValue({ kind: 'unavailable' });
    render(<FamilyScreen />);

    await waitFor(() => expect(screen.getByText(t('family.sync.unavailable'))).toBeTruthy());
    expect(screen.queryByText(t('family.sync.create'))).toBeNull();
  });

  it('参加中だが届かない（オフライン等）: 文言と再読み込みだけ。生のエラーを出さない', async () => {
    mockGetSyncState.mockResolvedValue({
      kind: 'joined',
      credentials: { groupId: 'g1', deviceId: 'd1', deviceSecret: 's' },
    });
    mockFetchSyncMe.mockRejectedValue(new Error('Network request failed'));
    render(<FamilyScreen />);

    await waitFor(() => expect(screen.getByText(t('family.sync.offlineJoined'))).toBeTruthy());
    expect(screen.getByText(t('family.sync.retry'))).toBeTruthy();
    expect(screen.queryByText(/Network request failed/)).toBeNull();
  });

  // ── 招待リンク（docs/クラウド同期設計.md §2-2b） ─────────────────────────

  it('招待リンクで開いた（未参加）: コードが入り、同意ダイアログ→参加まで進む', async () => {
    mockSearchParams = { invite: 'abcd-2345' };
    mockGetSyncState.mockResolvedValue({ kind: 'none' });
    mockDialogConfirm.mockResolvedValue(true); // 同意
    mockJoinSyncGroup.mockResolvedValue({ groupId: 'g1', deviceId: 'd2', deviceSecret: 's' });
    render(<FamilyScreen />);

    await waitFor(() => expect(mockJoinSyncGroup).toHaveBeenCalledWith('ABCD2345', null));
    // 同意の瞬間は既存の確認ダイアログ（消費者側の文言は変えない）
    expect(mockDialogConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: t('family.sync.join') }),
    );
    // 処理したらパラメータを消す（同じリンクをもう一度タップしたときに再び動くため）
    expect(mockSetParams).toHaveBeenCalledWith({ invite: '' });
  });

  it('招待リンクで開いた（未参加）: 同意しなければ参加しない', async () => {
    mockSearchParams = { invite: 'ABCD2345' };
    mockGetSyncState.mockResolvedValue({ kind: 'none' });
    mockDialogConfirm.mockResolvedValue(false);
    render(<FamilyScreen />);

    await waitFor(() => expect(mockDialogConfirm).toHaveBeenCalled());
    expect(mockJoinSyncGroup).not.toHaveBeenCalled();
    // コードは入力欄に残る（手で参加し直せる）
    expect(screen.getByDisplayValue('ABCD2345')).toBeTruthy();
  });

  it('招待リンクで開いた（参加中）: 参加は走らず「離脱してから」と伝える', async () => {
    mockSearchParams = { invite: 'ABCD2345' };
    mockGetSyncState.mockResolvedValue({
      kind: 'joined',
      credentials: { groupId: 'g1', deviceId: 'd1', deviceSecret: 's' },
    });
    mockFetchSyncMe.mockResolvedValue(ME_OWNER);
    render(<FamilyScreen />);

    await waitFor(() =>
      expect(mockDialogAlert).toHaveBeenCalledWith(
        expect.objectContaining({ message: t('family.sync.inviteLinkAlreadyJoined') }),
      ),
    );
    expect(mockJoinSyncGroup).not.toHaveBeenCalled();
    expect(mockDialogConfirm).not.toHaveBeenCalled();
  });

  it('招待リンクなし: ダイアログは何も出ない', async () => {
    mockGetSyncState.mockResolvedValue({ kind: 'none' });
    render(<FamilyScreen />);

    await waitFor(() => expect(screen.getByText(t('family.sync.create'))).toBeTruthy());
    expect(mockDialogConfirm).not.toHaveBeenCalled();
    expect(mockDialogAlert).not.toHaveBeenCalled();
    expect(mockSetParams).not.toHaveBeenCalled();
  });
});
