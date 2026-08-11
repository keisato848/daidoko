/**
 * S15: Settings hub
 * Account, family, data management, and app info sections
 */
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { CoachMarkOverlay } from '../../src/components/CoachMarkOverlay';
import { HelpButton } from '../../src/components/HelpButton';
import { Colors } from '../../src/constants/theme';
import { t, tCount } from '../../src/i18n';
import { useCoachMarks } from '../../src/hooks/useCoachMarks';
import { resetCoachMarks } from '../../src/services/coach-marks.service';
import {
  getCurrentFamily,
  getCurrentFamilyProfile,
  getCurrentUser,
  getCurrentUserProfile,
} from '../../src/services/user.service';
import { getAdRewardProvider } from '../../src/services/ad-reward.service';
import { isLaunchCameraEnabled, setLaunchCameraEnabled } from '../../src/services/app-meta.service';
import { getFreemiumStatus, type FreemiumStatus } from '../../src/services/usage.service';
import { useUnitSystemStore } from '../../src/stores/unitSystem.store';
import { formatProfileDisplayName } from '../../src/utils/profile';

interface SettingItem {
  id: string;
  label: string;
  subtitle?: string;
  statusLabel?: string;
  enabled: boolean;
  onPress?: () => void;
  /** 指定するとシェブロンの代わりにスイッチを出す（行タップでも切り替わる） */
  toggle?: { value: boolean; onValueChange: (next: boolean) => void };
}

interface SettingSection {
  title: string;
  items: SettingItem[];
}

const APP_VERSION_LABEL = `v${Constants.expoConfig?.version ?? '1.1.0'}`;

export default function SettingsScreen() {
  const router = useRouter();
  const [user, setUser] = useState(getCurrentUser());
  const [family, setFamily] = useState(getCurrentFamily());
  const [freemium, setFreemium] = useState<FreemiumStatus | null>(null);
  const [adPrivacyRequired, setAdPrivacyRequired] = useState(false);
  // R3: アプリを開いたらすぐ撮影（既定オフ）
  const [launchCamera, setLaunchCamera] = useState(false);
  const userDisplayName = formatProfileDisplayName(user.displayName);

  useFocusEffect(
    useCallback(() => {
      void Promise.all([getCurrentUserProfile(), getCurrentFamilyProfile()]).then(
        ([nextUser, nextFamily]) => {
          setUser(nextUser);
          setFamily(nextFamily);
        },
      );
      void getFreemiumStatus()
        .then(setFreemium)
        .catch(() => setFreemium(null));
      // GDPR 対象地域の広告ユーザーだけに UMP 同意の再変更導線を出す（それ以外は false）
      void getAdRewardProvider()
        .isPrivacyOptionsRequired()
        .then(setAdPrivacyRequired)
        .catch(() => setAdPrivacyRequired(false));
      void isLaunchCameraEnabled()
        .then(setLaunchCamera)
        .catch(() => setLaunchCamera(false));
    }, []),
  );

  const unitSystem = useUnitSystemStore((state) => state.system);
  const setUnitSystem = useUnitSystemStore((state) => state.setSystem);

  // 2 択なので専用の画面は作らず、その場で選ばせる。
  // 言語とは別の設定にしてある（英国の利用者は英語だがメートル法）
  const handlePickUnitSystem = useCallback(() => {
    Alert.alert(t('settings.display.unitSystem'), t('settings.display.unitSystemBody'), [
      {
        text: t('settings.display.unitMetric'),
        onPress: () => void setUnitSystem('metric').catch(() => undefined),
      },
      {
        text: t('settings.display.unitImperial'),
        onPress: () => void setUnitSystem('imperial').catch(() => undefined),
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }, [setUnitSystem]);

  const handleToggleLaunchCamera = useCallback((next: boolean) => {
    // 先に画面へ反映してから保存する（トグルの反応を待たせない）
    setLaunchCamera(next);
    void setLaunchCameraEnabled(next).catch(() => setLaunchCamera(!next));
  }, []);

  // Plan row content depends on premium state (avoid nested ternaries).
  let planLabel = t('settings.plan.upgrade');
  let planSubtitle = t('settings.plan.loading');
  let planOnPress = () => router.push('/recipes/paywall');
  if (freemium) {
    if (freemium.isPremium) {
      planLabel = t('settings.plan.premium');
      planSubtitle = t('settings.plan.premiumSubtitle');
      planOnPress = () => Alert.alert(t('settings.plan.premium'), t('settings.plan.premiumBody'));
    } else if (freemium.isByok) {
      planLabel = t('settings.plan.byok');
      planSubtitle = t('settings.plan.byokSubtitle');
      planOnPress = () => router.push('/(tabs)/ai-key');
    } else {
      planSubtitle = tCount('settings.plan.freeRemaining', freemium.remaining);
    }
  }

  const showComingSoon = () => {
    Alert.alert(t('settings.comingSoonTitle'), t('settings.comingSoonBody'));
  };

  // 初回利用ガイド（コーチマーク）
  const planRef = useRef<View>(null);
  const backupRef = useRef<View>(null);
  const coach = useCoachMarks('settings', [
    {
      key: 'plan',
      title: t('settings.coach.planTitle'),
      text: t('settings.coach.planText'),
      ref: planRef,
    },
    {
      key: 'backup',
      title: t('settings.coach.backupTitle'),
      text: t('settings.coach.backupText'),
      ref: backupRef,
    },
    {
      key: 'guide',
      title: t('settings.coach.guideTitle'),
      text: t('settings.coach.guideText'),
    },
  ]);

  const sections: SettingSection[] = [
    {
      title: t('settings.display.sectionTitle'),
      items: [
        {
          id: 'unit-system',
          label: t('settings.display.unitSystem'),
          subtitle:
            unitSystem === 'imperial'
              ? t('settings.display.unitImperialSubtitle')
              : t('settings.display.unitMetricSubtitle'),
          statusLabel:
            unitSystem === 'imperial'
              ? t('settings.display.unitImperial')
              : t('settings.display.unitMetric'),
          enabled: true,
          onPress: handlePickUnitSystem,
        },
      ],
    },
    {
      title: t('settings.reproduce.sectionTitle'),
      items: [
        {
          id: 'launch-camera',
          label: t('settings.reproduce.launchCamera'),
          subtitle: t('settings.reproduce.launchCameraSubtitle'),
          enabled: true,
          toggle: { value: launchCamera, onValueChange: handleToggleLaunchCamera },
        },
      ],
    },
    {
      title: t('settings.plan.sectionTitle'),
      items: [
        {
          id: 'plan',
          label: planLabel,
          subtitle: planSubtitle,
          enabled: true,
          onPress: planOnPress,
        },
        {
          id: 'byok',
          label: t('settings.byok.label'),
          subtitle: freemium?.isByok
            ? t('settings.byok.configured')
            : t('settings.byok.notConfigured'),
          enabled: true,
          onPress: () => router.push('/(tabs)/ai-key'),
        },
        ...(adPrivacyRequired
          ? [
              {
                id: 'ad-privacy',
                label: t('settings.adPrivacy.label'),
                subtitle: t('settings.adPrivacy.subtitle'),
                enabled: true,
                onPress: () => {
                  void getAdRewardProvider()
                    .showPrivacyOptionsForm()
                    .catch(() => {
                      Alert.alert(
                        t('settings.adPrivacy.failedTitle'),
                        t('settings.adPrivacy.failedBody'),
                      );
                    });
                },
              },
            ]
          : []),
      ],
    },
    {
      title: t('settings.account.sectionTitle'),
      items: [
        {
          id: 'profile',
          label: t('settings.account.profile'),
          subtitle: userDisplayName,
          enabled: true,
          onPress: () => router.push('/(tabs)/family'),
        },
      ],
    },
    {
      title: t('settings.family.sectionTitle'),
      items: [
        {
          id: 'family',
          label: t('settings.family.group'),
          subtitle: tCount('settings.family.groupSubtitle', family.memberCount, {
            name: family.name,
          }),
          enabled: true,
          onPress: () => router.push('/(tabs)/family'),
        },
        {
          id: 'invite',
          label: t('settings.family.invite'),
          enabled: true,
          onPress: () => router.push('/(tabs)/family'),
        },
      ],
    },
    {
      title: t('settings.data.sectionTitle'),
      items: [
        {
          id: 'backup',
          label: t('settings.data.backup'),
          subtitle: t('settings.data.backupSubtitle'),
          enabled: true,
          onPress: () => router.push('/(tabs)/backup'),
        },
        {
          id: 'sync',
          label: t('settings.data.sync'),
          subtitle: t('settings.data.syncSubtitle'),
          statusLabel: t('settings.comingSoonStatus'),
          enabled: false,
          onPress: showComingSoon,
        },
        {
          id: 'name-aliases',
          label: t('settings.data.nameAliases'),
          subtitle: t('settings.data.nameAliasesSubtitle'),
          enabled: true,
          onPress: () => router.push('/(tabs)/name-aliases'),
        },
      ],
    },
    {
      title: t('settings.app.sectionTitle'),
      items: [
        {
          id: 'coach-marks',
          label: t('settings.app.replayCoachMarks'),
          subtitle: t('settings.app.replayCoachMarksSubtitle'),
          enabled: true,
          onPress: () => {
            void resetCoachMarks().then(() => {
              Alert.alert(
                t('settings.app.coachMarksResetTitle'),
                t('settings.app.coachMarksResetBody'),
              );
            });
          },
        },
        {
          id: 'version',
          label: t('settings.app.version'),
          subtitle: APP_VERSION_LABEL,
          enabled: true,
        },
        {
          id: 'licenses',
          label: t('settings.app.licenses'),
          subtitle: t('settings.app.licensesSubtitle'),
          enabled: true,
          onPress: () => router.push('/(tabs)/licenses'),
        },
      ],
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
        <HelpButton onPress={coach.show} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* User card */}
        <View style={styles.userCard}>
          <Avatar name={userDisplayName} size={48} />
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{userDisplayName}</Text>
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
                ref={item.id === 'plan' ? planRef : item.id === 'backup' ? backupRef : undefined}
                collapsable={false}
                style={[styles.settingRow, !item.enabled && styles.settingRowDisabled]}
                onPress={
                  item.toggle ? () => item.toggle?.onValueChange(!item.toggle.value) : item.onPress
                }
                disabled={!item.onPress && !item.toggle}
                accessibilityRole={item.toggle ? 'switch' : 'button'}
                {...(item.toggle && { accessibilityState: { checked: item.toggle.value } })}
              >
                <View style={styles.settingContent}>
                  <Text style={[styles.settingLabel, !item.enabled && styles.settingLabelDisabled]}>
                    {item.label}
                  </Text>
                  {item.subtitle && <Text style={styles.settingSubtitle}>{item.subtitle}</Text>}
                  {item.statusLabel && <Text style={styles.statusBadge}>{item.statusLabel}</Text>}
                </View>
                {item.toggle ? (
                  <Switch
                    value={item.toggle.value}
                    onValueChange={item.toggle.onValueChange}
                    trackColor={{ false: Colors.border, true: Colors.gold }}
                    thumbColor={Colors.paper}
                  />
                ) : (
                  item.onPress && (
                    <ChevronRight size={16} color={item.enabled ? Colors.goldDim : Colors.muted} />
                  )
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>

      <CoachMarkOverlay
        visible={coach.visible}
        step={coach.step}
        index={coach.index}
        total={coach.total}
        onNext={coach.next}
        onSkip={coach.skip}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  statusBadge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.goldDim,
    color: Colors.goldDim,
    fontSize: 11,
    fontWeight: '500',
  },
});
