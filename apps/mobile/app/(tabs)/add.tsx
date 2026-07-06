/**
 * S08: Add Recipe — Method selection bottom sheet
 * Entry point for manual, text, URL, photo inference, and OCR-based recipe creation.
 */
import { useRouter } from 'expo-router';
import { Camera, FileText, Globe, Image as ImageIcon, PenLine } from 'lucide-react-native';
import { useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { CoachMarkOverlay } from '../../src/components/CoachMarkOverlay';
import { HelpButton } from '../../src/components/HelpButton';
import { PressableScale } from '../../src/components/PressableScale';
import { Colors } from '../../src/constants/theme';
import { useCoachMarks } from '../../src/hooks/useCoachMarks';

interface MethodOption {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  enabled: boolean;
  /** 端末内 ML Kit を使う機能は Android のみ（iOS 版がないため入口を隠す）。 */
  androidOnly?: boolean;
}

const METHODS: MethodOption[] = [
  {
    id: 'manual',
    icon: <PenLine size={24} color={Colors.gold} />,
    label: '手動で入力',
    description: 'レシピを一から入力する',
    enabled: true,
  },
  {
    id: 'text',
    icon: <FileText size={24} color={Colors.gold} />,
    label: 'テキストから作成',
    description: '本文を貼り付けて下書き化',
    enabled: true,
  },
  {
    id: 'url',
    icon: <Globe size={24} color={Colors.gold} />,
    label: 'URLから取り込み',
    description: 'レシピサイトのURLを貼り付け',
    enabled: true,
  },
  {
    id: 'photo',
    icon: <Camera size={24} color={Colors.gold} />,
    label: '写真からレシピ',
    description: '料理の写真からレシピの下書きをつくる',
    enabled: true,
  },
  {
    id: 'ocr',
    icon: <ImageIcon size={24} color={Colors.gold} />,
    label: '文字入り画像から作成',
    description: 'レシピ本や手書きメモの文字を読み取り',
    enabled: true,
    androidOnly: true,
  },
];

const VISIBLE_METHODS = METHODS.filter(
  (method) => !method.androidOnly || Platform.OS === 'android',
);

export default function AddScreen() {
  const router = useRouter();

  // 初回利用ガイド（コーチマーク）
  const photoRef = useRef<View>(null);
  const manualRef = useRef<View>(null);
  const coach = useCoachMarks('add', [
    {
      key: 'photo',
      title: '写真からAIでレシピ',
      text: '料理の写真を選ぶだけでAIが下書きを作成します。URL取り込み・文字入り画像の読み取りもここから（AI解析には1日の無料枠があります）。',
      ref: photoRef,
    },
    {
      key: 'manual',
      title: 'じっくり書くなら手動で',
      text: '一から入力。表紙写真・手順ごとの写真・タイマーも設定できます。',
      ref: manualRef,
    },
  ]);

  const handleSelect = (method: MethodOption) => {
    if (!method.enabled) return;
    if (method.id === 'manual') {
      router.push('/recipes/new');
    } else if (method.id === 'text') {
      router.push('/recipes/import-text');
    } else if (method.id === 'url') {
      router.push('/recipes/import-url');
    } else if (method.id === 'photo') {
      router.push('/recipes/import-photo');
    } else if (method.id === 'ocr') {
      router.push('/recipes/import-ocr');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>レシピを追加</Text>
        <HelpButton onPress={coach.show} />
      </View>
      <Text style={styles.subheading}>追加方法を選んでください</Text>

      <View style={styles.methods}>
        {VISIBLE_METHODS.map((method) => (
          <View
            key={method.id}
            ref={method.id === 'photo' ? photoRef : method.id === 'manual' ? manualRef : undefined}
            collapsable={false}
          >
            <PressableScale
              style={[styles.methodCard, !method.enabled && styles.methodCardDisabled]}
              onPress={() => handleSelect(method)}
            >
              <View style={styles.methodIcon}>{method.icon}</View>
              <View style={styles.methodText}>
                <Text style={[styles.methodLabel, !method.enabled && styles.methodLabelDisabled]}>
                  {method.label}
                </Text>
                <Text style={styles.methodDescription}>{method.description}</Text>
                {!method.enabled && <Text style={styles.comingSoon}>今後追加予定</Text>}
              </View>
            </PressableScale>
          </View>
        ))}
      </View>

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
    paddingTop: 80,
    paddingHorizontal: 20,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  heading: {
    fontSize: 20, // lg: 画面タイトル
    fontWeight: '500',
    color: Colors.paper,
    letterSpacing: 1,
  },
  subheading: {
    fontSize: 13, // sm: 補足テキスト
    fontWeight: '400',
    color: Colors.paperDim,
    marginBottom: 32,
  },
  methods: {
    gap: 12,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    gap: 14,
  },
  methodCardDisabled: {
    opacity: 0.5,
  },
  methodIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1A1108',
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodText: {
    flex: 1,
  },
  methodLabel: {
    fontSize: 15, // base: 選択肢ラベル
    fontWeight: '500',
    color: Colors.paper,
    marginBottom: 2,
  },
  methodLabelDisabled: {
    color: Colors.muted,
  },
  methodDescription: {
    fontSize: 13, // sm: 補足説明
    fontWeight: '400',
    color: Colors.paperDim,
  },
  comingSoon: {
    fontSize: 11, // xxs: 今後追加予定ラベル
    color: Colors.goldDim,
    fontStyle: 'italic',
    marginTop: 4,
  },
});
