/**
 * S15: Settings hub
 * Account, family, data management, and app info sections
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { Colors } from '../../src/constants/theme';
import {
  getCurrentFamily,
  getCurrentFamilyProfile,
  getCurrentUser,
  getCurrentUserProfile,
} from '../../src/services/user.service';

interface SettingItem {
  id: string;
  label: string;
  subtitle?: string;
  enabled: boolean;
  onPress?: () => void;
}

interface SettingSection {
  title: string;
  items: SettingItem[];
}

export default function SettingsScreen() {
  const router = useRouter();
  const [user, setUser] = useState(getCurrentUser());
  const [family, setFamily] = useState(getCurrentFamily());

  useFocusEffect(
    useCallback(() => {
      void Promise.all([getCurrentUserProfile(), getCurrentFamilyProfile()]).then(
        ([nextUser, nextFamily]) => {
          setUser(nextUser);
          setFamily(nextFamily);
        },
      );
    }, []),
  );

  const showComingSoon = () => {
    Alert.alert('準備中', 'この機能は今後のバージョンで追加予定です。');
  };

  const sections: SettingSection[] = [
    {
      title: 'アカウント',
      items: [
        {
          id: 'profile',
          label: 'プロフィール編集',
          subtitle: user.displayName,
          enabled: false,
          onPress: showComingSoon,
        },
      ],
    },
    {
      title: '家族',
      items: [
        {
          id: 'family',
          label: '家族グループ',
          subtitle: `${family.name}（${family.memberCount}人）`,
          enabled: true,
          onPress: () => router.push('/(tabs)/family'),
        },
        {
          id: 'invite',
          label: '家族を招待',
          enabled: true,
          onPress: () => router.push('/(tabs)/family'),
        },
      ],
    },
    {
      title: 'データ',
      items: [
        {
          id: 'backup',
          label: 'バックアップ・復元',
          enabled: false,
          onPress: showComingSoon,
        },
        {
          id: 'sync',
          label: 'クラウド同期',
          subtitle: 'オフ',
          enabled: false,
          onPress: showComingSoon,
        },
      ],
    },
    {
      title: 'アプリ',
      items: [
        {
          id: 'version',
          label: 'バージョン',
          subtitle: 'v0.5.0 Beta',
          enabled: false,
        },
        {
          id: 'licenses',
          label: 'ライセンス情報',
          enabled: false,
          onPress: showComingSoon,
        },
      ],
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <Text style={styles.headerTitle}>設定</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* User card */}
        <View style={styles.userCard}>
          <Avatar name={user.displayName} size={48} />
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{user.displayName}</Text>
            <Text style={styles.familyName}>{family.name}</Text>
          </View>
        </View>

        {/* Setting sections */}
        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.items.map((item) => (
              <Pressable
                key={item.id}
                style={[styles.settingRow, !item.enabled && styles.settingRowDisabled]}
                onPress={item.onPress}
                disabled={!item.onPress}
              >
                <View style={styles.settingContent}>
                  <Text style={[styles.settingLabel, !item.enabled && styles.settingLabelDisabled]}>
                    {item.label}
                  </Text>
                  {item.subtitle && <Text style={styles.settingSubtitle}>{item.subtitle}</Text>}
                </View>
                {item.onPress && (
                  <ChevronRight size={16} color={item.enabled ? Colors.goldDim : Colors.muted} />
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  headerBar: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: 20, // lg: 画面タイトル
    fontWeight: '500',
    color: Colors.paper,
    letterSpacing: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  userInfo: {
    gap: 2,
  },
  userName: {
    fontSize: 17, // md: ユーザー名
    fontWeight: '500',
    color: Colors.paper,
  },
  familyName: {
    fontSize: 13, // sm: 家族名
    fontWeight: '400',
    color: Colors.paperDim,
  },
  section: {
    paddingTop: 20,
  },
  sectionTitle: {
    fontSize: 12, // xs: セクションヘッダー（大文字化で強調）
    fontWeight: '500',
    color: Colors.goldDim,
    letterSpacing: 2,
    paddingHorizontal: 20,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  settingRowDisabled: {
    opacity: 0.6,
  },
  settingContent: {
    flex: 1,
    gap: 2,
  },
  settingLabel: {
    fontSize: 15, // base: 設定項目ラベル
    fontWeight: '400',
    color: Colors.paper,
  },
  settingLabelDisabled: {
    color: Colors.paperDim,
  },
  settingSubtitle: {
    fontSize: 13, // sm: 設定項目の補足
    fontWeight: '400',
    color: Colors.paperDim,
  },
});
