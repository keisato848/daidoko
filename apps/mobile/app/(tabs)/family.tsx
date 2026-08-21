/**
 * S16: 家族グループ。
 *
 * プロフィール・メンバー（調理記録の「誰が」用）はローカルのまま。
 * 招待コード・参加は **クラウド共有（同期 S0）の本物**に置き換えた —
 * 以前はローカルのモックで、コードを発行しても相手に何も届かなかった。
 * docs/クラウド同期設計.md §2。参加/作成の確認ダイアログが同意の瞬間（§5-2）。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, Copy, LogOut, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { KeyboardAwareScroll } from '../../src/components/KeyboardAwareScroll';
import { Colors } from '../../src/constants/theme';
import { t, tCount } from '../../src/i18n';
import {
  SyncError,
  createSyncGroup,
  deleteSyncGroup,
  fetchSyncMe,
  getSyncState,
  joinSyncGroup,
  leaveSyncGroup,
  rotateSyncInvite,
  type SyncErrorCode,
  type SyncMe,
} from '../../src/services/sync-client.service';
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
        Alert.alert(t('family.saveFailedTitle'), message);
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

  const handleRemoveMember = (member: FamilyMember) => {
    Alert.alert(t('family.removeTitle'), t('family.removeConfirm', { name: member.displayName }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          void runAction(async () => removeFamilyMember(member.id));
        },
      },
    ]);
  };

  /** 同期 API を1つ実行する共通処理。失敗は SyncError を人間の言葉にして出す */
  const runSyncAction = useCallback(
    async (action: () => Promise<void>) => {
      setSyncBusy(true);
      try {
        await action();
      } catch (err) {
        Alert.alert(t('family.sync.errorTitle'), syncErrorText(err));
        // グループが消えていた場合は表示も未参加へ戻す
        if (err instanceof SyncError && err.code === 'AUTH_INVALID') await loadCloud();
      } finally {
        setSyncBusy(false);
      }
    },
    [loadCloud],
  );

  /** グループ作成。確認ダイアログが「何が共有されるか」への同意の瞬間（§5-2） */
  const handleCreateGroup = () => {
    Alert.alert(t('family.sync.consentTitle'), t('family.sync.consentBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('family.sync.create'),
        onPress: () => {
          void runSyncAction(async () => {
            await createSyncGroup(currentUser.displayName.trim() || null);
            await loadCloud();
            Alert.alert(t('family.sync.createdTitle'), t('family.sync.createdBody'));
          });
        },
      },
    ]);
  };

  const handleJoinGroup = () => {
    const code = joinCode.trim();
    if (!code) return;
    Alert.alert(t('family.sync.consentTitle'), t('family.sync.consentBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('family.sync.join'),
        onPress: () => {
          void runSyncAction(async () => {
            await joinSyncGroup(code, currentUser.displayName.trim() || null);
            setJoinCode('');
            await loadCloud();
            Alert.alert(t('family.sync.joinedTitle'), t('family.sync.joinedBody'));
          });
        },
      },
    ]);
  };

  const handleShareInvite = (code: string) => {
    void Share.share({ message: t('family.sync.shareMessage', { code }) }).catch(() => {
      Alert.alert(t('family.sync.inviteLabel'), code);
    });
  };

  const handleRotateInvite = () => {
    void runSyncAction(async () => {
      await rotateSyncInvite();
      await loadCloud();
    });
  };

  const handleLeaveGroup = () => {
    Alert.alert(t('family.sync.leaveConfirmTitle'), t('family.sync.leaveConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('family.sync.leave'),
        style: 'destructive',
        onPress: () => {
          void runSyncAction(async () => {
            await leaveSyncGroup();
            await loadCloud();
          });
        },
      },
    ]);
  };

  const handleDeleteGroup = () => {
    Alert.alert(t('family.sync.deleteConfirmTitle'), t('family.sync.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          void runSyncAction(async () => {
            await deleteSyncGroup();
            await loadCloud();
          });
        },
      },
    ]);
  };

  const hasProfileChanges =
    familyName.trim() !== family.name || displayName.trim() !== currentUser.displayName;
  const canAddMember = newMemberName.trim().length > 0 && !saving;
  const canJoin = joinCode.trim().length > 0 && !saving;

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
                <Pressable onPress={() => handleRemoveMember(member)} hitSlop={10}>
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
                onPress={handleCreateGroup}
                disabled={syncBusy}
              >
                <Text style={styles.primaryButtonText}>{t('family.sync.create')}</Text>
              </Pressable>
              <View style={styles.inlineForm}>
                <TextInput
                  style={[styles.input, styles.inlineInput]}
                  value={joinCode}
                  onChangeText={(value) => setJoinCode(value.toUpperCase())}
                  placeholder={t('family.sync.joinPlaceholder')}
                  placeholderTextColor={Colors.muted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={12}
                />
                <Pressable
                  style={[styles.iconButton, !canJoin && styles.buttonDisabled]}
                  onPress={handleJoinGroup}
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
              <Pressable
                style={[styles.leaveButton, syncBusy && styles.buttonDisabled]}
                onPress={handleLeaveGroup}
                disabled={syncBusy}
              >
                <LogOut size={15} color="#FF6B6B" />
                <Text style={styles.leaveButtonText}>{t('family.sync.leave')}</Text>
              </Pressable>
              {cloud.me.isOwner && (
                <Pressable
                  style={[styles.deleteGroupButton, syncBusy && styles.buttonDisabled]}
                  onPress={handleDeleteGroup}
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
    opacity: 0.4,
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
