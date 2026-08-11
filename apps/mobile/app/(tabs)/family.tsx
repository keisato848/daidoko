/**
 * S16: Family Group Management
 * Local-first family profile, members, invite code, and join flow.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, Copy, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { KeyboardAvoider } from '../../src/components/KeyboardAvoider';
import { Colors } from '../../src/constants/theme';
import { t, tCount } from '../../src/i18n';
import {
  addFamilyMember,
  getCurrentFamily,
  getCurrentFamilyProfile,
  getCurrentUser,
  getCurrentUserProfile,
  getFamilyMembers,
  joinFamilyByInviteCode,
  removeFamilyMember,
  rotateCurrentFamilyInviteCode,
  updateCurrentFamilyName,
  updateCurrentUserDisplayName,
} from '../../src/services/user.service';
import type { CurrentFamily, CurrentUser, FamilyMember } from '../../src/services/types';
import { formatProfileDisplayName } from '../../src/utils/profile';

function roleLabel(role: FamilyMember['role']): string {
  return role === 'owner' ? t('family.role.owner') : t('family.role.member');
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

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
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

  const handleRotateInviteCode = () => {
    void runAction(async () => {
      await rotateCurrentFamilyInviteCode();
    });
  };

  const handleShareCode = async () => {
    await Share.share({
      message: t('family.shareMessage', { name: family.name, code: family.inviteCode }),
      title: t('family.shareTitle'),
    }).catch(() => {
      Alert.alert(t('family.inviteSection'), family.inviteCode);
    });
  };

  const handleJoinWithCode = () => {
    void runAction(async () => {
      const result = await joinFamilyByInviteCode(joinCode);
      setJoinCode('');
      if (result.status === 'already-member') {
        Alert.alert(
          t('family.alreadyMemberTitle'),
          t('family.alreadyMemberBody', { name: result.family.name }),
        );
      } else {
        Alert.alert(t('family.joinedTitle'), t('family.joinedBody', { name: result.family.name }));
      }
    });
  };

  const hasProfileChanges =
    familyName.trim() !== family.name || displayName.trim() !== currentUser.displayName;
  const canAddMember = newMemberName.trim().length > 0 && !saving;
  const canJoin = joinCode.trim().length > 0 && !saving;

  return (
    <KeyboardAvoider style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={20} color={Colors.goldDim} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('family.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
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
          <Text style={styles.sectionTitle}>{t('family.inviteSection')}</Text>
          <View style={styles.inviteCodeBox}>
            <Text style={styles.inviteCode}>{family.inviteCode}</Text>
          </View>
          <View style={styles.buttonRow}>
            <Pressable style={styles.secondaryButton} onPress={handleShareCode} disabled={saving}>
              <Copy size={14} color={Colors.gold} />
              <Text style={styles.secondaryButtonText}>{t('family.share')}</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={handleRotateInviteCode}
              disabled={saving}
            >
              <RefreshCw size={14} color={Colors.gold} />
              <Text style={styles.secondaryButtonText}>{t('family.rotate')}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('family.joinSection')}</Text>
          <View style={styles.inlineForm}>
            <TextInput
              style={[styles.input, styles.inlineInput]}
              value={joinCode}
              onChangeText={(value) => setJoinCode(value.toUpperCase())}
              placeholder={t('family.joinPlaceholder')}
              placeholderTextColor={Colors.muted}
              autoCapitalize="characters"
              maxLength={12}
            />
            <Pressable
              style={[styles.iconButton, !canJoin && styles.buttonDisabled]}
              onPress={handleJoinWithCode}
              disabled={!canJoin}
            >
              <UserPlus size={17} color={Colors.bg} />
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoider>
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
});
