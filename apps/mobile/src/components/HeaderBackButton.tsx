/**
 * 階層画面（ルート Stack）のヘッダの「＜」。
 *
 * N3（`docs/画面設計.md` §4-1）: 戻り先が自明でない画面は「＜」に**戻り先の名前**を
 * 添える（例: ＜ 設定）。隆（受け身層）「戻り先が予想できないアプリは、迷った時点で
 * 使うのをやめる」。
 *
 * ラベルは**ナビゲーション状態の 1 つ手前のルート**から引く。静的に「設定」と書くと、
 * 同じ画面が別の親からも開かれたときに嘘をつく（例: menu-settings は設定からも
 * 献立の歯車からも開く。family は共有状態カードやレシピ詳細からも開く）。
 * 手前のルートが対応表に無いとき（タブ画面 (tabs) やディープリンク直開きなど）は
 * ラベル無しの「＜」だけを出す — 間違った名前を出すよりよい。
 */
import { useNavigation, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Colors } from '../constants/theme';
import { t } from '../i18n';

/** 戻り先のルート名 → 表示名（このアプリで階層画面の push 元になるルートだけ載せる）。 */
const PARENT_TITLES: Record<string, () => string> = {
  settings: () => t('settings.title'),
  menu: () => t('menu.title'),
  'share-status': () => t('settings.shareStatus.title'),
  'web-shares': () => t('settings.webShares.title'),
};

export function HeaderBackButton() {
  const router = useRouter();
  const navigation = useNavigation();

  // 1 つ手前のルート名。ここは表示専用 — 実際の戻り先は router.back() が決める
  // （「＜」と Android 戻るは常に同じ行き先: N2）
  let parentLabel: string | null = null;
  const state = navigation.getState();
  if (state && state.index > 0) {
    const previous = state.routes[state.index - 1];
    const title = previous ? PARENT_TITLES[previous.name] : undefined;
    parentLabel = title ? title() : null;
  }

  return (
    <Pressable
      style={styles.backButton}
      onPress={() => router.back()}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={parentLabel ? `${t('common.back')}: ${parentLabel}` : t('common.back')}
    >
      <ChevronLeft size={20} color={Colors.goldDim} />
      {parentLabel != null && (
        <Text style={styles.backLabel} numberOfLines={1}>
          {parentLabel}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backButton: {
    minWidth: 36,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // ラベルが付くと左に寄って見えるので、シェブロン側だけ少し詰める
    paddingRight: 6,
    maxWidth: 140,
  },
  backLabel: {
    color: Colors.goldDim,
    fontSize: 13,
    marginLeft: 2,
  },
});
