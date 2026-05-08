/**
 * S08: Add Recipe — Method selection bottom sheet
 * Manual entry is active; URL import and OCR show "coming soon"
 */
import { useRouter } from 'expo-router';
import { Camera, Globe, PenLine } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
    id: 'url',
    icon: <Globe size={24} color={Colors.gold} />,
    label: 'URLから取り込み',
    description: 'レシピサイトのURLを貼り付け',
    enabled: true,
  },
  {
    id: 'ocr',
    icon: <Camera size={24} color={Colors.muted} />,
    label: '写真から読み取り',
    description: 'レシピ本や手書きメモを撮影',
    enabled: false,
  },
];

export default function AddScreen() {
  const router = useRouter();

  const handleSelect = (method: MethodOption) => {
    if (!method.enabled) return;
    if (method.id === 'manual') {
      router.push('/recipes/new');
    } else if (method.id === 'url') {
      router.push('/recipes/import-url');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>レシピを追加</Text>
      <Text style={styles.subheading}>追加方法を選んでください</Text>

      <View style={styles.methods}>
        {METHODS.map((method) => (
          <Pressable
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
              {!method.enabled && <Text style={styles.comingSoon}>Coming Soon</Text>}
            </View>
          </Pressable>
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
    fontSize: 11, // xxs: Coming Soon ラベル
    color: Colors.goldDim,
    fontStyle: 'italic',
    marginTop: 4,
  },
});
