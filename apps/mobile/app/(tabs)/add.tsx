/**
 * S08: Add Recipe — Method selection bottom sheet
 * Entry point for manual, text, URL, photo inference, and OCR-based recipe creation.
 */
import { useRouter } from 'expo-router';
import {
  Camera,
  FileText,
  Globe,
  Image as ImageIcon,
  MessagesSquare,
  PenLine,
} from 'lucide-react-native';
import { useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { CoachMarkOverlay } from '../../src/components/CoachMarkOverlay';
import { HelpButton } from '../../src/components/HelpButton';
import { PressableScale } from '../../src/components/PressableScale';
import { Colors } from '../../src/constants/theme';
import { t } from '../../src/i18n';
import { useCoachMarks } from '../../src/hooks/useCoachMarks';

type MethodId = 'photo' | 'consult' | 'url' | 'text' | 'ocr' | 'manual';

interface MethodOption {
  id: MethodId;
  icon: React.ReactNode;
  enabled: boolean;
  /** 端末内 ML Kit を使う機能は Android のみ（iOS 版がないため入口を隠す）。 */
  androidOnly?: boolean;
}

// 主役（写真からレシピ）を先頭に置く。以前は 5 択の 4 番目で、上に手動・テキスト・URL が
// 並んでいた（`docs/お店の味を再現設計.md` §4.3 問題2）。手動入力は最後でよい。
// **文言は定数に持たせない。** import 時のロケールで固定されてしまう。
// ここには見た目の定義（アイコン・並び・対応 OS）だけを置き、
// ラベルと説明は描画のたびに辞書から引く
const METHODS: MethodOption[] = [
  {
    id: 'photo',
    icon: <Camera size={24} color={Colors.gold} />,
    enabled: true,
  },
  {
    // 写真の次。写真は「目の前に料理がある」とき、相談は「まだ料理が無い」とき
    id: 'consult',
    icon: <MessagesSquare size={24} color={Colors.gold} />,
    enabled: true,
  },
  {
    id: 'url',
    icon: <Globe size={24} color={Colors.gold} />,
    enabled: true,
  },
  {
    id: 'text',
    icon: <FileText size={24} color={Colors.gold} />,
    enabled: true,
  },
  {
    // 端末内 ML Kit から AI に置き換えたので Android 限定ではなくなった
    // （`docs/レシピ推論の評価設計.md` §10）
    id: 'ocr',
    icon: <ImageIcon size={24} color={Colors.gold} />,
    enabled: true,
  },
  {
    id: 'manual',
    icon: <PenLine size={24} color={Colors.gold} />,
    enabled: true,
  },
];

function methodLabel(id: MethodId): string {
  if (id === 'photo') return t('recipe.add.method.photo');
  if (id === 'consult') return t('recipe.add.method.consult');
  if (id === 'url') return t('recipe.add.method.url');
  if (id === 'text') return t('recipe.add.method.text');
  if (id === 'ocr') return t('recipe.add.method.ocr');
  return t('recipe.add.method.manual');
}

function methodDescription(id: MethodId): string {
  if (id === 'photo') return t('recipe.add.method.photoDescription');
  if (id === 'consult') return t('recipe.add.method.consultDescription');
  if (id === 'url') return t('recipe.add.method.urlDescription');
  if (id === 'text') return t('recipe.add.method.textDescription');
  if (id === 'ocr') return t('recipe.add.method.ocrDescription');
  return t('recipe.add.method.manualDescription');
}

const VISIBLE_METHODS = METHODS.filter(
  (method) => !method.androidOnly || Platform.OS === 'android',
);

export default function AddScreen() {
  const router = useRouter();

  // 初回利用ガイド（コーチマーク）。写真 → 相談 → 手動の 3 枚。
  // 1 枚目の吹き出しは 2 枚目のカード（相談）を丸ごと隠すので、相談には自分の吹き出しを持たせる
  // （隠れたカードの話を 1 枚目でするのは読めない — 実機で確認した 2026-08-23）
  const photoRef = useRef<View>(null);
  const consultRef = useRef<View>(null);
  const manualRef = useRef<View>(null);
  const coach = useCoachMarks('add', [
    {
      key: 'photo',
      title: t('recipe.add.coach.photoTitle'),
      text: t('recipe.add.coach.photoText'),
      ref: photoRef,
    },
    {
      key: 'consult',
      title: t('recipe.add.coach.consultTitle'),
      text: t('recipe.add.coach.consultText'),
      ref: consultRef,
    },
    {
      key: 'manual',
      title: t('recipe.add.coach.manualTitle'),
      text: t('recipe.add.coach.manualText'),
      ref: manualRef,
    },
  ]);

  // コーチマークがハイライトするカードだけ ref を持つ（入れ子の三項演算を避ける）
  const coachRefFor = (id: MethodId) => {
    if (id === 'photo') return photoRef;
    if (id === 'consult') return consultRef;
    if (id === 'manual') return manualRef;
    return undefined;
  };

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
    } else if (method.id === 'consult') {
      router.push('/recipes/consult');
    } else if (method.id === 'ocr') {
      router.push('/recipes/import-ocr');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>{t('recipe.add.heading')}</Text>
        <HelpButton onPress={coach.show} />
      </View>
      <Text style={styles.subheading}>{t('recipe.add.subheading')}</Text>

      <View style={styles.methods}>
        {VISIBLE_METHODS.map((method) => (
          <View key={method.id} ref={coachRefFor(method.id)} collapsable={false}>
            <PressableScale
              style={[styles.methodCard, !method.enabled && styles.methodCardDisabled]}
              onPress={() => handleSelect(method)}
            >
              <View style={styles.methodIcon}>{method.icon}</View>
              <View style={styles.methodText}>
                <Text style={[styles.methodLabel, !method.enabled && styles.methodLabelDisabled]}>
                  {methodLabel(method.id)}
                </Text>
                <Text style={styles.methodDescription}>{methodDescription(method.id)}</Text>
                {!method.enabled && (
                  <Text style={styles.comingSoon}>{t('settings.comingSoonStatus')}</Text>
                )}
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
