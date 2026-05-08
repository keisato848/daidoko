/**
 * S16: Family Group Management
 * Shows current members, invite code, and join flow
 * Auth / server sync is v2.0; this screen handles local family state
 */
import { Copy, UserPlus, Users } from 'lucide-react-native';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { Colors } from '../../src/constants/theme';
import { getCurrentFamily, getCurrentUser } from '../../src/services/user.service';

const SEED_MEMBERS = [
  { id: 'user-kei', displayName: '恵', role: 'オーナー' },
  { id: 'user-ken', displayName: '健', role: 'メンバー' },
  { id: 'user-yo', displayName: '陽', role: 'メンバー' },
] as const;

function generateInviteCode(familyId: string): string {
  // Deterministic 8-char code from familyId (local only until server auth)
  const hash = familyId.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffffffff, 0);
  return Math.abs(hash).toString(36).toUpperCase().padStart(8, '0').slice(0, 8);
}

export default function FamilyScreen() {
  const family = getCurrentFamily();
  const currentUser = getCurrentUser();
  const inviteCode = generateInviteCode(family.id);

  const handleCopyCode = async () => {
    await Share.share({
      message: `だいどこの家族グループ「${family.name}」に招待します。\n招待コード: ${inviteCode}\nhttps://daidoko.app/join`,
      title: 'だいどこ 招待コード',
    }).catch(() => {
      Alert.alert('コピー', `招待コード: ${inviteCode}`);
    });
  };

  const handleJoinWithCode = () => {
    Alert.alert(
      'コードで参加',
      'クラウド同期は v2.0 で対応予定です。\n現在は同じ端末・iCloud でのみ家族データを共有できます。',
      [{ text: 'OK' }],
    );
  };

  const handleLeave = () => {
    Alert.alert('グループから抜ける', 'この機能はクラウド同期（v2.0）で対応予定です。', [
      { text: 'OK' },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>家族グループ</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Group info */}
        <View style={styles.groupCard}>
          <View style={styles.groupIcon}>
            <Users size={28} color={Colors.gold} />
          </View>
          <View style={styles.groupInfo}>
            <Text style={styles.groupName}>{family.name}</Text>
            <Text style={styles.groupMeta}>{family.memberCount}人のメンバー</Text>
          </View>
        </View>

        {/* Members */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>メンバー</Text>
          {SEED_MEMBERS.map((member) => (
            <View key={member.id} style={styles.memberRow}>
              <Avatar name={member.displayName} size={36} />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>
                  {member.displayName}
                  {member.id === currentUser.id && <Text style={styles.memberYou}> (あなた)</Text>}
                </Text>
                <Text style={styles.memberRole}>{member.role}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Invite code */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>招待コード</Text>
          <View style={styles.inviteCard}>
            <Text style={styles.inviteCode}>{inviteCode}</Text>
            <Text style={styles.inviteNote}>
              このコードを家族に共有してグループに参加してもらいましょう
            </Text>
            <Pressable style={styles.shareButton} onPress={handleCopyCode}>
              <Copy size={14} color={Colors.bg} />
              <Text style={styles.shareButtonText}>招待コードを共有</Text>
            </Pressable>
          </View>
        </View>

        {/* Join with code */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>別のグループに参加</Text>
          <Pressable style={styles.joinButton} onPress={handleJoinWithCode}>
            <UserPlus size={16} color={Colors.goldDim} />
            <Text style={styles.joinButtonText}>招待コードを入力して参加</Text>
          </Pressable>
          <Text style={styles.comingSoonNote}>
            ※ クラウドを介した家族共有は v2.0 で対応予定です。
          </Text>
        </View>

        {/* Leave */}
        <View style={styles.section}>
          <Pressable style={styles.leaveButton} onPress={handleLeave}>
            <Text style={styles.leaveButtonText}>グループから抜ける</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '500',
    color: Colors.paper,
    letterSpacing: 1,
  },
  scrollContent: {
    paddingBottom: 48,
  },
  groupCard: {
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
  groupInfo: { gap: 2 },
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
    paddingTop: 24,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.goldDim,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  memberInfo: { gap: 1 },
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
  inviteCard: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  inviteCode: {
    fontSize: 28,
    fontWeight: '600',
    color: Colors.gold,
    letterSpacing: 8,
  },
  inviteNote: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.paperDim,
    textAlign: 'center',
    lineHeight: 18,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.gold,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  shareButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.bg,
  },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    marginBottom: 10,
  },
  joinButtonText: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  comingSoonNote: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.muted,
    marginBottom: 16,
    lineHeight: 18,
  },
  leaveButton: {
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FF6B6B44',
    borderRadius: 8,
    marginBottom: 16,
  },
  leaveButtonText: {
    fontSize: 15,
    fontWeight: '400',
    color: '#FF6B6B',
  },
});
