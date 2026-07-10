/**
 * BYOK settings — let the user paste their own Gemini API key. When set, the app
 * calls Gemini directly (no server) and the daily limit is removed. The key is
 * stored encrypted on-device (expo-secure-store) and never sent anywhere except
 * Google. See docs/フリーミアム設計.md §9.
 */
import { useRouter } from 'expo-router';
import { KeyRound, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { InfoTooltip } from '../../src/components/InfoTooltip';
import { Colors } from '../../src/constants/theme';
import {
  clearUserApiKey,
  getUserApiKey,
  looksLikeApiKey,
  setUserApiKey,
} from '../../src/services/byok.service';

const AI_STUDIO_URL = 'https://aistudio.google.com/apikey';

export default function AiKeyScreen() {
  const router = useRouter();
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    getUserApiKey()
      .then((key) => {
        if (mounted) setHasKey(key !== null);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = useCallback(async () => {
    if (!looksLikeApiKey(keyInput)) {
      Alert.alert('お知らせ', 'APIキーの形式が正しくないようです。貼り付け直してください。');
      return;
    }
    setBusy(true);
    try {
      await setUserApiKey(keyInput);
      setHasKey(true);
      setKeyInput('');
      Alert.alert('保存しました', '自分のキーで、写真からのレシピづくりが無制限になりました。');
      router.back();
    } catch {
      Alert.alert('お知らせ', 'キーを保存できませんでした。');
    } finally {
      setBusy(false);
    }
  }, [keyInput, router]);

  const handleClear = useCallback(() => {
    Alert.alert('キーを削除', '保存したAPIキーを削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: () => {
          void clearUserApiKey().then(() => {
            setHasKey(false);
            setKeyInput('');
          });
        },
      },
    ]);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="閉じる">
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>自分のAIキー</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.iconWrap}>
          <KeyRound size={34} color={Colors.gold} />
        </View>

        <Text style={styles.lead}>
          自分の Gemini API
          キーを入れると、写真からのレシピづくりが回数無制限になります（サーバーを介さず、あなたのキーで直接実行）。
        </Text>
        <Text style={styles.note}>
          キーは端末内に暗号化して保存され、Google 以外には送信されません。料金はあなたの Google
          アカウントに課金されます。
        </Text>

        {hasKey && <Text style={styles.statusOn}>● 設定済み（無制限）</Text>}

        <TextInput
          style={styles.input}
          value={keyInput}
          onChangeText={setKeyInput}
          placeholder={
            hasKey ? '新しいキーで上書きする場合は貼り付け' : 'AIza... から始まるキーを貼り付け'
          }
          placeholderTextColor={Colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          multiline={false}
        />

        <Pressable
          accessibilityRole="button"
          style={[styles.saveButton, busy && styles.disabled]}
          onPress={handleSave}
          disabled={busy}
        >
          <Text style={styles.saveText}>保存する</Text>
        </Pressable>

        {hasKey && (
          <Pressable accessibilityRole="button" style={styles.clearButton} onPress={handleClear}>
            <Text style={styles.clearText}>保存したキーを削除</Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="link"
          onPress={() => Linking.openURL(AI_STUDIO_URL).catch(() => undefined)}
          hitSlop={8}
        >
          <Text style={styles.link}>キーの取得方法（Google AI Studio）</Text>
        </Pressable>

        <View style={styles.detailsSection}>
          <InfoTooltip
            label="保存場所"
            detail="端末のセキュアな保管領域（Android は Keystore、iPhone は Keychain）に暗号化して保存します。だいどこのサーバーには一切送信されません。"
          />
          <InfoTooltip
            label="送信先"
            detail="キーを保存すると、写真からのレシピづくりは端末から Google の Gemini に直接送信されます（だいどこのサーバーは経由しません）。料金はキーを発行した Google アカウントに直接課金されます。"
          />
          <InfoTooltip
            label="削除方法"
            detail="上の「保存したキーを削除」でいつでも削除できます。アプリをアンインストールした場合も、端末の保管領域ごと自動的に削除されます。"
          />
          <InfoTooltip
            label="機種変更・バックアップについて"
            detail="このキーはバックアップ・機種変更用の移行ファイルには含まれません（意図的な設計です）。新しい端末では、この画面でキーを貼り付け直してください。"
          />
          <InfoTooltip
            label="対応しているキー"
            detail="現在は Google の Gemini API キーのみに対応しています。他社（OpenAI・Claude など）のキーは使用できません。"
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 15, fontWeight: '500', color: Colors.paper, letterSpacing: 0.5 },
  headerSpacer: { width: 20 },
  body: { paddingHorizontal: 24, paddingVertical: 28, gap: 14 },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1A1108',
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 4,
  },
  lead: { fontSize: 14, color: Colors.paper, lineHeight: 22 },
  note: { fontSize: 12, color: Colors.paperDim, lineHeight: 18 },
  statusOn: { fontSize: 13, color: Colors.gold, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: '#130E08',
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.paper,
    marginTop: 4,
  },
  saveButton: {
    backgroundColor: Colors.gold,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  saveText: { fontSize: 15, fontWeight: '600', color: Colors.bg },
  disabled: { opacity: 0.55 },
  clearButton: { paddingVertical: 10, alignItems: 'center' },
  clearText: { fontSize: 13, color: '#F2A07B' },
  link: { fontSize: 13, color: Colors.gold, textDecorationLine: 'underline', marginTop: 8 },
  detailsSection: { marginTop: 10 },
});
