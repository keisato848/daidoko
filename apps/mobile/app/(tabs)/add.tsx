/**
 * S08: Add Recipe — Method selection bottom sheet
 * Entry point for manual, text, URL, photo inference, and OCR-based recipe creation.
 */
import { useRouter } from 'expo-router';
import { Camera, FileText, Globe, Image as ImageIcon, PenLine } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '../../src/components/PressableScale';
import { Colors } from '../../src/constants/theme';

interface MethodOption {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  enabled: boolean;
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
    label: '料理写真から推測',
    description: '写っている料理から下書き案を作成',
    enabled: true,
  },
  {
    id: 'ocr',
    icon: <ImageIcon size={24} color={Colors.gold} />,
    label: '文字入り画像から作成',
    description: 'レシピ本や手書きメモの文字を読み取り',
    enabled: true,
  },
];

export default function AddScreen() {
  const router = useRouter();

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
      <Text style={styles.heading}>レシピを追加</Text>
      <Text style={styles.subheading}>追加方法を選んでください</Text>

      <View style={styles.methods}>
        {METHODS.map((method) => (
          <PressableScale
            key={method.id}
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
        ))}
      </View>
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
  heading: {
    fontSize: 20, // lg: 画面タイトル
    fontWeight: '500',
    color: Colors.paper,
    letterSpacing: 1,
    marginBottom: 4,
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
