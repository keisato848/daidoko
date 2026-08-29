/**
 * BYOK settings — let the user paste their own Gemini API key. When set, the app
 * calls Gemini directly (no server) and the daily limit is removed. The key is
 * stored encrypted on-device (expo-secure-store) and never sent anywhere except
 * Google. See docs/フリーミアム設計.md §9.
 */
import { useRouter } from 'expo-router';
import { KeyRound, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { InfoTooltip } from '../../src/components/InfoTooltip';
import { KeyboardAwareScroll } from '../../src/components/KeyboardAwareScroll';
import { Colors } from '../../src/constants/theme';
import { t } from '../../src/i18n';
import { dialog } from '../../src/services/dialog.service';
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
      void dialog.alert({ title: t('byok.invalidTitle'), message: t('byok.invalidBody') });
      return;
    }
    setBusy(true);
    try {
      await setUserApiKey(keyInput);
      setHasKey(true);
      setKeyInput('');
      // 直後に画面を離れるのでトーストでは見えない。通知ダイアログのまま（§7-1）
      await dialog.alert({ title: t('byok.savedTitle'), message: t('byok.savedBody') });
      router.back();
    } catch {
      void dialog.alert({ title: t('byok.saveFailedTitle'), message: t('byok.saveFailedBody') });
    } finally {
      setBusy(false);
    }
  }, [keyInput, router]);

  const handleClear = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: t('byok.removeTitle'),
      message: t('byok.removeConfirm'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!confirmed) return;
    await clearUserApiKey();
    setHasKey(false);
    setKeyInput('');
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityLabel={t('common.close')}
        >
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('byok.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAwareScroll contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrap}>
          <KeyRound size={34} color={Colors.gold} />
        </View>

        <Text style={styles.lead}>{t('byok.lead')}</Text>
        <Text style={styles.note}>{t('byok.billingNote')}</Text>
        <Text style={styles.note}>{t('byok.imageBillingNote')}</Text>

        {hasKey && <Text style={styles.statusOn}>● {t('settings.byok.configured')}</Text>}

        <TextInput
          style={styles.input}
          value={keyInput}
          onChangeText={setKeyInput}
          placeholder={hasKey ? t('byok.inputPlaceholderReplace') : t('byok.inputPlaceholderNew')}
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
          <Text style={styles.saveText}>{t('byok.save')}</Text>
        </Pressable>

        {hasKey && (
          <Pressable
            accessibilityRole="button"
            style={styles.clearButton}
            onPress={() => void handleClear()}
          >
            <Text style={styles.clearText}>{t('byok.remove')}</Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="link"
          onPress={() => Linking.openURL(AI_STUDIO_URL).catch(() => undefined)}
          hitSlop={8}
        >
          <Text style={styles.link}>{t('byok.howTo')}</Text>
        </Pressable>

        <View style={styles.detailsSection}>
          <InfoTooltip label={t('byok.detail.storageTitle')} detail={t('byok.detail.storage')} />
          <InfoTooltip
            label={t('byok.detail.destinationTitle')}
            detail={t('byok.detail.destination')}
          />
          <InfoTooltip label={t('byok.detail.removalTitle')} detail={t('byok.detail.removal')} />
          <InfoTooltip
            label={t('byok.detail.migrationTitle')}
            detail={t('byok.detail.migration')}
          />
          <InfoTooltip
            label={t('byok.detail.supportedTitle')}
            detail={t('byok.detail.supported')}
          />
        </View>
      </KeyboardAwareScroll>
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
