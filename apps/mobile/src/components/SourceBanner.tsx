/**
 * 取り込み元の情報（読み取り精度・正規化・サイト名）を RecipeForm の上に出す帯。
 *
 * **ステータスバーの分だけ上を空ける。** 以前は 3 つの取り込み画面（テキスト・URL・文字入り画像）が
 * 同じ帯をそれぞれ持ち、どれも上を空けていなかったので時計の上に被っていた
 * （OCR の結果画面・Pixel 9a・2026-08-23）。
 *
 * 下に続く `RecipeForm` には `topInset={false}` を渡すこと。両方が空けると、
 * 帯と見出しの間にステータスバー 1 つ分の隙間ができる。
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';

/** 画面上部のヘッダーが使っているステータスバー分の余白と同じ値（`app/` の header と揃える）。 */
export const STATUS_BAR_OFFSET = 54;

interface SourceBannerProps {
  icon: ReactNode;
  text: string;
}

export function SourceBanner({ icon, text }: SourceBannerProps) {
  return (
    <View style={styles.banner} testID="source-banner">
      {icon}
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: STATUS_BAR_OFFSET,
    paddingBottom: 8,
    backgroundColor: Colors.bgInput,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  text: {
    flex: 1,
    fontSize: Typography.size.xs,
    color: Colors.goldDim,
  },
});
