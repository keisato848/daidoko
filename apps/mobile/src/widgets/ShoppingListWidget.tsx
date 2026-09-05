/**
 * 買い物リストウィジェット（W1・Android・`docs/ウィジェット設計.md` §2）の見た目。
 *
 * react-native-android-widget の JSX（FlexWidget/TextWidget）— 通常の
 * react-native の View/Text ではなく、この 2 種類だけが Android の RemoteViews に
 * 変換される。文言・行整形は `shoppingWidgetContent`（純関数・テスト対象）に
 * 切り出し済みで、ここは組み立てるだけ。
 *
 * ブランドカラーは `CLAUDE.md` §4 のパレット。padding は**設計 §4 の
 * 「ランチャーのサイズ報告ズレ→クロップは余白 8dp+ で吸収」**を満たすため
 * 12dp（8dp を下回らない）を確保する。
 */
import { FlexWidget, TextWidget } from 'react-native-android-widget';

import type { WidgetSnapshot } from '../utils/widgetSnapshot';
import { buildShoppingWidgetContent } from './shoppingWidgetContent';
import type { WidgetSize } from './shoppingWidgetContent';

const COLORS = {
  background: '#0A0805',
  gold: '#C9A16A',
  text: '#DCC9A8',
  faint: '#2E2418',
} as const;

// クロップ吸収の余白（設計 §4）。8dp を下回らない
const SAFE_PADDING = 12;

export interface ShoppingListWidgetProps {
  snapshot: WidgetSnapshot | null;
  size: WidgetSize;
}

export function ShoppingListWidget({ snapshot, size }: ShoppingListWidgetProps) {
  const content = buildShoppingWidgetContent(snapshot, size);

  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'daidoko://shopping' }}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        alignItems: 'flex-start',
        backgroundColor: COLORS.background,
        padding: SAFE_PADDING,
      }}
    >
      <TextWidget
        text={content.title}
        style={{ color: COLORS.gold, fontSize: 13, fontWeight: 'bold' }}
        maxLines={1}
      />

      {content.countLabel ? (
        <TextWidget
          text={content.countLabel}
          style={{ color: COLORS.text, fontSize: 12, marginTop: 4 }}
          maxLines={1}
        />
      ) : null}

      {content.emptyMessage ? (
        <TextWidget
          text={content.emptyMessage}
          style={{ color: COLORS.text, fontSize: 12, marginTop: 8 }}
          maxLines={2}
        />
      ) : null}

      {content.lines.map((name, index) => (
        <TextWidget
          key={`${index}-${name}`}
          text={`・${name}`}
          style={{ color: COLORS.text, fontSize: 12, marginTop: 2 }}
          truncate="END"
          maxLines={1}
        />
      ))}

      {content.moreLabel ? (
        <TextWidget
          text={content.moreLabel}
          style={{ color: COLORS.gold, fontSize: 11, marginTop: 2 }}
          maxLines={1}
        />
      ) : null}

      {content.timeLabel ? (
        <TextWidget
          text={content.timeLabel}
          style={{ color: COLORS.faint, fontSize: 10, marginTop: 6 }}
          maxLines={1}
        />
      ) : null}
    </FlexWidget>
  );
}
