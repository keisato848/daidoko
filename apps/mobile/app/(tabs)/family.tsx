/**
 * S16: 家族グループ。
 *
 * プロフィール・メンバー（調理記録の「誰が」用）はローカルのまま。
 * 招待コード・参加は **クラウド共有（同期 S0）の本物**に置き換えた —
 * 以前はローカルのモックで、コードを発行しても相手に何も届かなかった。
 * docs/クラウド同期設計.md §2。参加/作成の確認ダイアログが同意の瞬間（§5-2）。
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Copy, LogOut, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { KeyboardAwareScroll } from '../../src/components/KeyboardAwareScroll';
import { Toast } from '../../src/components/Toast';
import { Colors } from '../../src/constants/theme';
import { t, tCount } from '../../src/i18n';
import { dialog } from '../../src/services/dialog.service';
import {
  SyncError,
  createSyncGroup,
  deleteSyncGroup,
  evictSyncDevice,
  fetchSyncMe,
  getSyncState,
  inviteLinkUrl,
  joinSyncGroup,
  leaveSyncGroup,
  rotateSyncInvite,
  type SyncErrorCode,
  type SyncMe,
} from '../../src/services/sync-client.service';
import {
  countUndecidedSharedPantryItems,
  revertUndecidedPantryItemsShared,
  setUndecidedPantryItemsShared,
} from '../../src/services/pantry.service';
import {
  countUndecidedSharedShoppingItems,
  revertUndecidedShoppingItemsShared,
  setUndecidedShoppingItemsShared,
} from '../../src/services/shopping-list.service';
import { onSyncGroupJoined, onSyncGroupLeft } from '../../src/services/sync-runner.service';
import {
  addFamilyMember,
  getCurrentFamily,
  getCurrentFamilyProfile,
  getCurrentUser,
  getCurrentUserProfile,
  getFamilyMembers,
  removeFamilyMember,
  updateCurrentFamilyName,
  updateCurrentUserDisplayName,
} from '../../src/services/user.service';
import type { CurrentFamily, CurrentUser, FamilyMember } from '../../src/services/types';
import { formatProfileDisplayName } from '../../src/utils/profile';

/** 「最終同期」の相対表示。日付そのものは個人情報ではないが、細かすぎる時刻は出さない */
function formatLastSeen(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return t('family.sync.devices.justNow');
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return t('family.sync.devices.today');
  return tCount('family.sync.devices.daysAgo', days);
}

function roleLabel(role: FamilyMember['role']): string {
  return role === 'owner' ? t('family.role.owner') : t('family.role.member');
}

/** クラウド共有セクションの表示状態 */
type CloudPhase =
  | { kind: 'loading' }
  | { kind: 'unavailable' } // Web など同期の無い環境
  | { kind: 'none' } // 未参加
  | { kind: 'offline-joined' } // 参加中だがサーバーに届かない（オフライン・準備中）
  | { kind: 'joined'; me: SyncMe };

/** SyncError を人間の言葉へ（生のエラーを画面に出さない — #202） */
function syncErrorText(err: unknown): string {
  const code: SyncErrorCode | null = err instanceof SyncError ? err.code : null;
  switch (code) {
    case 'INVITE_INVALID':
      return t('family.sync.error.inviteInvalid');
    case 'INVITE_EXPIRED':
      return t('family.sync.error.inviteExpired');
    case 'GROUP_FULL':
      return t('family.sync.error.groupFull');
    case 'RATE_LIMITED':
      return t('family.sync.error.rateLimited');
    case 'OWNER_ONLY':
      return t('family.sync.error.ownerOnly');
    case 'AUTH_INVALID':
      return t('family.sync.error.authInvalid');
    case 'ALREADY_JOINED':
      return t('family.sync.error.alreadyJoined');
    case 'NETWORK':
      return t('family.sync.error.network');
    case 'SYNC_UNAVAILABLE':
      return t('family.sync.unavailable');
    default:
      return t('family.sync.error.server');
  }
}

function formatInviteExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 日本語 IME は全角で確定することがある（実機で 404 になった）。NFKC で半角に寄せる */
function normalizeJoinCode(value: string): string {
  return value.normalize('NFKC').toUpperCase();
}

export default function FamilyScreen() {
  const router = useRouter();
  const [family, setFamily] = useState<CurrentFamily>(getCurrentFamily());
  const [currentUser, setCurrentUser] = useState<CurrentUser>(getCurrentUser());
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [familyName, setFamilyName] = useState(family.name);
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [newMemberName, setNewMemberName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [cloud, setCloud] = useState<CloudPhase>({ kind: 'loading' });
  const [syncBusy, setSyncBusy] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextUser, nextFamily, nextMembers] = await Promise.all([
      getCurrentUserProfile(),
      getCurrentFamilyProfile(),
      getFamilyMembers(),
    ]);
    setCurrentUser(nextUser);
    setFamily(nextFamily);
    setMembers(nextMembers);
    setDisplayName(nextUser.displayName);
    setFamilyName(nextFamily.name);
  }, []);

  const loadCloud = useCallback(async () => {
    const state = await getSyncState();
    if (state.kind === 'unavailable') {
      setCloud({ kind: 'unavailable' });
      return;
    }
    if (state.kind === 'none') {
      setCloud({ kind: 'none' });
      return;
    }
    try {
      setCloud({ kind: 'joined', me: await fetchSyncMe() });
    } catch (err) {
      // AUTH_INVALID = グループ側で消された。鍵は破棄済みなので未参加へ自己修復
      if (err instanceof SyncError && err.code === 'AUTH_INVALID') setCloud({ kind: 'none' });
      else setCloud({ kind: 'offline-joined' });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void loadCloud();
    }, [refresh, loadCloud]),
  );

  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      setSaving(true);
      try {
        await action();
        await refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : t('family.saveFailed');
        void dialog.alert({ title: t('family.saveFailedTitle'), message });
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  const handleSaveProfile = () => {
    void runAction(async () => {
      if (displayName.trim() !== currentUser.displayName) {
        await updateCurrentUserDisplayName(displayName);
      }
      if (familyName.trim() !== family.name) {
        await updateCurrentFamilyName(familyName);
      }
    });
  };

  const handleAddMember = () => {
    void runAction(async () => {
      await addFamilyMember(newMemberName);
      setNewMemberName('');
    });
  };

  const handleRemoveMember = async (member: FamilyMember) => {
    const confirmed = await dialog.confirm({
      title: t('family.removeTitle'),
      message: t('family.removeConfirm', { name: member.displayName }),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!confirmed) return;
    await runAction(async () => removeFamilyMember(member.id));
  };

  /** 同期 API を1つ実行する共通処理。失敗は SyncError を人間の言葉にして出す */
  const runSyncAction = useCallback(
    async (action: () => Promise<void>) => {
      setSyncBusy(true);
      try {
        await action();
      } catch (err) {
        void dialog.alert({ title: t('family.sync.errorTitle'), message: syncErrorText(err) });
        // グループが消えていた場合は表示も未参加へ戻す
        if (err instanceof SyncError && err.code === 'AUTH_INVALID') await loadCloud();
      } finally {
        setSyncBusy(false);
      }
    },
    [loadCloud],
  );

  /**
   * いまある買い物・在庫を共有するかを一度だけ聞く（設計 §5-2）。
   *
   * **参加より先に聞き、答えを反映してから参加する。** 参加してから聞くと二つ壊れる —
   * 実機検証（2026-08-22）で両方とも起きた:
   *
   * 1. 「自分だけ」を選んでも手遅れ。参加した瞬間に全件が送信待ちへ積まれ、
   *    いまある品目が一度サーバーへ出てしまう。
   * 2. **家族の品目を消す。** 参加直後の pull で降りてきた他端末の品目まで
   *    「いまある品目」に含まれ、`shared = 0` に倒れて墓標として押し返される。
   *
   * 先に聞けば、自分だけにした行はそもそも送信対象に入らない
   * （`listRowSyncableEntities` が共有中の行だけを返す）。
   *
   * 対象は**まだ共有可否を決めていない品目だけ**（`shared IS NULL`）。他端末から
   * 降りてきた品目は決定済みなので触らない。対象が無ければ聞かない。
   *
   * 戻り値は**答えを無かったことにする関数**。参加・作成がこの後で失敗したら呼ぶ —
   * 呼ばないと決定だけが残り、次に参加したときプロンプトが出ず、「自分だけ」にした
   * 品目は永久に同期されない／「共有する」にした品目は別のグループへ無確認で出る。
   */
  const askShareExistingItems = useCallback(async (): Promise<() => Promise<void>> => {
    const noop = async () => undefined;
    const [shopping, pantry] = await Promise.all([
      countUndecidedSharedShoppingItems().catch(() => 0),
      countUndecidedSharedPantryItems().catch(() => 0),
    ]);
    if (shopping === 0 && pantry === 0) return noop;

    const applyChoice = async (shared: boolean): Promise<() => Promise<void>> => {
      const [shoppingIds, pantryIds] = await Promise.all([
        setUndecidedShoppingItemsShared(shared).catch((): string[] => []),
        setUndecidedPantryItemsShared(shared).catch((): string[] => []),
      ]);
      return async () => {
        await Promise.all([
          revertUndecidedShoppingItemsShared(shoppingIds),
          revertUndecidedPantryItemsShared(pantryIds),
        ]).catch(() => undefined);
      };
    };

    // **答えが返るまで待つ**。ここを待たずに進めると D1 が戻る（上のコメント）。
    // 背景タップ・戻るキーは `dialog.confirm` の却下側＝第 1 ボタンに倒れるので、
    // 「共有しない」を第 1 ボタンに置くこと。逆にすると、確かめないまま
    // 手元の買い物リストと在庫が家族へ出る
    const share = await dialog.confirm({
      title: t('pantry.shared.askTitle'),
      message: t('pantry.shared.askBody'),
      cancelLabel: t('pantry.shared.askNo'),
      confirmLabel: t('pantry.shared.askYes'),
    });
    return applyChoice(share).catch(() => noop);
  }, []);

  /** グループ作成。確認ダイアログが「何が共有されるか」への同意の瞬間（§5-2） */
  const handleCreateGroup = async () => {
    const agreed = await dialog.confirm({
      title: t('family.sync.consentTitle'),
      message: t('family.sync.consentBody'),
      confirmLabel: t('family.sync.create'),
    });
    if (!agreed) return;
    await runSyncAction(async () => {
      // 送信が始まる前に、いまある品目をどうするか決めておく
      const revertShareChoice = await askShareExistingItems();
      try {
        // 表示名は送らない。サーバーは返さないので使い道が無く、
        // 「サーバーに個人情報を置かない」（設計 §2）に反するだけになる
        await createSyncGroup(null);
      } catch (err) {
        await revertShareChoice(); // 作れなかったのに決定だけ残さない
        throw err;
      }
      // 参加した瞬間から共有が始まる。いまある蔵書を全部送信待ちへ積む（§5-2）
      await onSyncGroupJoined();
      await loadCloud();
      // 次にやること（招待コードを家族に伝える）を含むのでトーストにしない（画面設計 §7-1）
      await dialog.alert({
        title: t('family.sync.createdTitle'),
        message: t('family.sync.createdBody'),
      });
    });
  };

  /** 参加。`codeArg` は招待リンクから来たとき（state の反映を待たずに始める） */
  const handleJoinGroup = async (codeArg?: string) => {
    const code = (codeArg ?? joinCode).trim();
    if (!code) return;
    const agreed = await dialog.confirm({
      title: t('family.sync.consentTitle'),
      message: t('family.sync.consentBody'),
      confirmLabel: t('family.sync.join'),
    });
    if (!agreed) return;
    await runSyncAction(async () => {
      const revertShareChoice = await askShareExistingItems();
      try {
        await joinSyncGroup(code, null);
      } catch (err) {
        await revertShareChoice(); // 招待コードの打ち間違い等。決定だけ残さない
        throw err;
      }
      setJoinCode('');
      await onSyncGroupJoined();
      await loadCloud();
      // 画面に留まる純粋な成功なのでトースト（docs/画面設計.md §7-1）
      setToastMessage(t('family.sync.joinedBody'));
    });
  };

  /**
   * 招待を OS の共有シートへ（LINE 等）。本文にリンクを入れる — 受け取った側はタップで
   * だいどこが開き、参加の確認まで進む（§2-2b）。コードも併記して手入力の逃げ道を残す
   */
  const handleShareInvite = (code: string) => {
    const message = t('family.sync.shareMessage', { code, url: inviteLinkUrl(code) });
    void Share.share({ message }).catch(() => {
      void dialog.alert({ title: t('family.sync.inviteLabel'), message: code });
    });
  };

  // ── 招待リンクの受け取り（app/j/[code].tsx → ?invite=CODE） ──────────────
  // クラウドの状態が分かってから 1 回だけ動かす。処理したらパラメータを消し、
  // 同じリンクをもう一度タップしたときにまた動けるようにする（画面は残り続けるため）
  const { invite: inviteParam } = useLocalSearchParams<{ invite?: string }>();
  const inviteFromLink =
    typeof inviteParam === 'string' ? normalizeJoinCode(inviteParam).replace(/[\s-]/g, '') : '';
  // 参加が終わって cloud.kind が変わったときに、消す前のパラメータでもう一度動かないための控え
  const handledInviteRef = useRef('');
  useEffect(() => {
    if (!inviteFromLink) {
      handledInviteRef.current = '';
      return;
    }
    if (cloud.kind === 'loading' || handledInviteRef.current === inviteFromLink) return;
    handledInviteRef.current = inviteFromLink;
    router.setParams({ invite: '' });
    if (cloud.kind === 'none') {
      setJoinCode(inviteFromLink);
      void handleJoinGroup(inviteFromLink);
      return;
    }
    // 既に参加中（またはサーバーに届かない・同期が使えない環境）。
    // 黙って捨てると「タップしたのに何も起きない」になるので一言出す
    void dialog.alert({
      title: t('family.sync.inviteLinkTitle'),
      message: t(
        cloud.kind === 'unavailable'
          ? 'family.sync.unavailable'
          : 'family.sync.inviteLinkAlreadyJoined',
      ),
    });
    // handleJoinGroup は毎描画で作り直されるので依存に入れない（入れると無限に再実行する）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteFromLink, cloud.kind, router]);

  const handleRotateInvite = () => {
    void runSyncAction(async () => {
      await rotateSyncInvite();
      await loadCloud();
    });
  };

  /**
   * 端末を外す（#209）。紛失・初期化した端末の幽霊を消す入口。
   * 端末には名前が無いので「最終同期 N 日前」だけで見分ける（§0-2: 個人情報を持たない）。
   */
  const handleEvictDevice = async (deviceId: string, lastSeenAt: string) => {
    const confirmed = await dialog.confirm({
      title: t('family.sync.devices.evictTitle'),
      message: t('family.sync.devices.evictBody', { when: formatLastSeen(lastSeenAt) }),
      confirmLabel: t('family.sync.devices.evict'),
      destructive: true,
    });
    if (!confirmed) return;
    await runSyncAction(async () => {
      await evictSyncDevice(deviceId);
      await loadCloud();
    });
  };

  const handleLeaveGroup = async () => {
    const confirmed = await dialog.confirm({
      title: t('family.sync.leaveConfirmTitle'),
      message: t('family.sync.leaveConfirmBody'),
      confirmLabel: t('family.sync.leave'),
      destructive: true,
    });
    if (!confirmed) return;
    await runSyncAction(async () => {
      await leaveSyncGroup();
      await onSyncGroupLeft();
      await loadCloud();
    });
  };

  const handleDeleteGroup = async () => {
    const confirmed = await dialog.confirm({
      title: t('family.sync.deleteConfirmTitle'),
      message: t('family.sync.deleteConfirmBody'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!confirmed) return;
    await runSyncAction(async () => {
      await deleteSyncGroup();
      await onSyncGroupLeft();
      await loadCloud();
    });
  };

  const hasProfileChanges =
    familyName.trim() !== family.name || displayName.trim() !== currentUser.displayName;
  const canAddMember = newMemberName.trim().length > 0 && !saving;
  // syncBusy も見る。参加の往復中にもう一度押せると**端末が 2 つ登録され**、片方は
  // 資格情報が無いので誰からも消せない幽霊になる
  const canJoin = joinCode.trim().length > 0 && !saving && !syncBusy;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={20} color={Colors.goldDim} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('family.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAwareScroll
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.groupSummary}>
          <View style={styles.groupIcon}>
            <Users size={28} color={Colors.gold} />
          </View>
          <View style={styles.groupInfo}>
            <Text style={styles.groupName}>{family.name}</Text>
            <Text style={styles.groupMeta}>{tCount('family.memberCount', family.memberCount)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('family.profileSection')}</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={t('family.displayNamePlaceholder')}
            placeholderTextColor={Colors.muted}
            maxLength={32}
          />
          <TextInput
            style={styles.input}
            value={familyName}
            onChangeText={setFamilyName}
            placeholder={t('family.groupNamePlaceholder')}
            placeholderTextColor={Colors.muted}
            maxLength={40}
          />
          <Pressable
            style={[styles.primaryButton, (!hasProfileChanges || saving) && styles.buttonDisabled]}
            onPress={handleSaveProfile}
            disabled={!hasProfileChanges || saving}
          >
            <Text style={styles.primaryButtonText}>{t('common.save')}</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('family.membersSection')}</Text>
          {members.map((member) => (
            <View key={member.id} style={styles.memberRow}>
              <Avatar name={formatProfileDisplayName(member.displayName)} size={36} />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {formatProfileDisplayName(member.displayName)}
                  {member.isCurrentUser && <Text style={styles.memberYou}>{t('family.you')}</Text>}
                </Text>
                <Text style={styles.memberRole}>{roleLabel(member.role)}</Text>
              </View>
              {member.role !== 'owner' && (
                <Pressable onPress={() => void handleRemoveMember(member)} hitSlop={10}>
                  <Trash2 size={17} color="#FF6B6B" />
                </Pressable>
              )}
            </View>
          ))}
          <View style={styles.inlineForm}>
            <TextInput
              style={[styles.input, styles.inlineInput]}
              value={newMemberName}
              onChangeText={setNewMemberName}
              placeholder={t('family.memberNamePlaceholder')}
              placeholderTextColor={Colors.muted}
              maxLength={32}
            />
            <Pressable
              style={[styles.iconButton, !canAddMember && styles.buttonDisabled]}
              onPress={handleAddMember}
              disabled={!canAddMember}
            >
              <UserPlus size={17} color={Colors.bg} />
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('family.sync.section')}</Text>

          {cloud.kind === 'loading' && <ActivityIndicator size="small" color={Colors.gold} />}

          {cloud.kind === 'unavailable' && (
            <Text style={styles.syncInfo}>{t('family.sync.unavailable')}</Text>
          )}

          {cloud.kind === 'offline-joined' && (
            <>
              <Text style={styles.syncInfo}>{t('family.sync.offlineJoined')}</Text>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => void loadCloud()}
                disabled={syncBusy}
              >
                <RefreshCw size={14} color={Colors.gold} />
                <Text style={styles.secondaryButtonText}>{t('family.sync.retry')}</Text>
              </Pressable>
            </>
          )}

          {cloud.kind === 'none' && (
            <>
              <Text style={styles.syncInfo}>{t('family.sync.introNone')}</Text>
              <Pressable
                style={[styles.primaryButton, syncBusy && styles.buttonDisabled]}
                onPress={() => void handleCreateGroup()}
                disabled={syncBusy}
              >
                <Text style={styles.primaryButtonText}>{t('family.sync.create')}</Text>
              </Pressable>
              <View style={styles.inlineForm}>
                <TextInput
                  style={[styles.input, styles.inlineInput]}
                  value={joinCode}
                  onChangeText={(value) => setJoinCode(normalizeJoinCode(value))}
                  placeholder={t('family.sync.joinPlaceholder')}
                  placeholderTextColor={Colors.muted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={12}
                />
                <Pressable
                  style={[styles.iconButton, !canJoin && styles.buttonDisabled]}
                  onPress={() => void handleJoinGroup()}
                  disabled={!canJoin}
                  accessibilityLabel={t('family.sync.join')}
                >
                  <UserPlus size={17} color={Colors.bg} />
                </Pressable>
              </View>
            </>
          )}

          {cloud.kind === 'joined' && (
            <>
              <Text style={styles.syncMemberCount}>
                {tCount('family.sync.memberCountLabel', cloud.me.memberCount)}
              </Text>
              {cloud.me.isOwner && cloud.me.inviteCode && (
                <>
                  <Text style={styles.syncInviteLabel}>{t('family.sync.inviteLabel')}</Text>
                  <View style={styles.inviteCodeBox}>
                    <Text style={styles.inviteCode}>{cloud.me.inviteCode}</Text>
                  </View>
                  {cloud.me.inviteExpiresAt && (
                    <Text style={styles.syncExpiry}>
                      {t('family.sync.inviteExpires', {
                        when: formatInviteExpiry(cloud.me.inviteExpiresAt),
                      })}
                    </Text>
                  )}
                  <View style={styles.buttonRow}>
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => handleShareInvite(cloud.me.inviteCode as string)}
                      disabled={syncBusy}
                    >
                      <Copy size={14} color={Colors.gold} />
                      <Text style={styles.secondaryButtonText}>{t('family.share')}</Text>
                    </Pressable>
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={handleRotateInvite}
                      disabled={syncBusy}
                    >
                      <RefreshCw size={14} color={Colors.gold} />
                      <Text style={styles.secondaryButtonText}>{t('family.rotate')}</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.syncOwnerBadge}>{t('family.sync.ownerBadge')}</Text>
                </>
              )}
              {cloud.me.devices && cloud.me.devices.length > 1 && (
                <View style={styles.deviceList}>
                  <Text style={styles.syncInviteLabel}>{t('family.sync.devices.label')}</Text>
                  {cloud.me.devices.map((device, index) => (
                    <View key={device.id} style={styles.deviceRow}>
                      <Text style={styles.deviceName}>
                        {device.isSelf
                          ? t('family.sync.devices.self')
                          : t('family.sync.devices.other', { index: index + 1 })}
                        {device.isOwner ? t('family.sync.devices.ownerMark') : ''}
                      </Text>
                      <Text style={styles.deviceMeta}>
                        {t('family.sync.devices.lastSeen', {
                          when: formatLastSeen(device.lastSeenAt),
                        })}
                      </Text>
                      {cloud.me.isOwner && !device.isSelf && (
                        <Pressable
                          onPress={() => void handleEvictDevice(device.id, device.lastSeenAt)}
                          disabled={syncBusy}
                          hitSlop={8}
                          accessibilityLabel={t('family.sync.devices.evict')}
                        >
                          <Text style={styles.deviceEvict}>{t('family.sync.devices.evict')}</Text>
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>
              )}
              <Pressable
                style={[styles.leaveButton, syncBusy && styles.buttonDisabled]}
                onPress={() => void handleLeaveGroup()}
                disabled={syncBusy}
              >
                <LogOut size={15} color="#FF6B6B" />
                <Text style={styles.leaveButtonText}>{t('family.sync.leave')}</Text>
              </Pressable>
              {cloud.me.isOwner && (
                <Pressable
                  style={[styles.deleteGroupButton, syncBusy && styles.buttonDisabled]}
                  onPress={() => void handleDeleteGroup()}
                  disabled={syncBusy}
                >
                  <Trash2 size={15} color="#FF6B6B" />
                  <Text style={styles.leaveButtonText}>{t('family.sync.deleteGroup')}</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      </KeyboardAwareScroll>

      <Toast
        message={toastMessage ?? ''}
        visible={toastMessage != null}
        onDismiss={() => setToastMessage(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 58,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: Colors.paper,
  },
  headerSpacer: { width: 36 },
  scrollContent: {
    paddingBottom: 48,
  },
  groupSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  groupIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1A1108',
    borderWidth: 1,
    borderColor: Colors.goldDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupInfo: { flex: 1, gap: 2 },
  groupName: {
    fontSize: 17,
    fontWeight: '500',
    color: Colors.paper,
  },
  groupMeta: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.goldDim,
    letterSpacing: 1,
    marginBottom: 2,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.bgInput,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paper,
  },
  primaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gold,
    borderRadius: 8,
    marginTop: 2,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.bg,
  },
  buttonDisabled: {
    // gold を半透過するだけだと「押せる薄い茶色のボタン」に見え、押せるのか
    // 迷わせる（ペルソナレビュー 1.12.2 #8 — 63歳は判別できなかった）。
    // 無彩色に落として「いまは押せない」を形で伝える
    opacity: 0.4,
    backgroundColor: Colors.bgInput,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
  },
  memberInfo: { flex: 1, gap: 1 },
  memberName: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paper,
  },
  memberYou: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.muted,
  },
  memberRole: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  inlineForm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  inlineInput: {
    flex: 1,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteCodeBox: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteCode: {
    fontSize: 26,
    fontWeight: '600',
    color: Colors.gold,
    letterSpacing: 6,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.goldDim,
    borderRadius: 8,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.gold,
  },
  syncInfo: {
    fontSize: 13,
    lineHeight: 20,
    color: Colors.paperDim,
    marginBottom: 10,
  },
  syncMemberCount: {
    fontSize: 14,
    color: Colors.paper,
    marginBottom: 10,
  },
  syncInviteLabel: {
    fontSize: 12,
    color: Colors.muted,
    marginBottom: 6,
  },
  syncExpiry: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: 6,
    marginBottom: 4,
  },
  deviceList: { marginTop: 12, gap: 6 },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  deviceName: { color: Colors.paper, fontSize: 13, flex: 1 },
  deviceMeta: { color: Colors.muted, fontSize: 11 },
  deviceEvict: { color: '#FF6B6B', fontSize: 12 },
  syncOwnerBadge: {
    fontSize: 12,
    color: Colors.goldDim,
    marginTop: 8,
  },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#5A2E2E',
    borderRadius: 10,
    paddingVertical: 11,
    marginTop: 14,
  },
  deleteGroupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 11,
    marginTop: 8,
  },
  leaveButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF6B6B',
  },
});
