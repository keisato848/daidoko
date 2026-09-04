/**
 * 献立ウィジェット（W2・Android・`docs/ウィジェット設計.md` §2）の見た目。
 *
 * react-native-android-widget の JSX（FlexWidget/TextWidget）— 通常の
 * react-native の View/Text ではなく、この 2 種類だけが Android の RemoteViews に
 * 変換される。文言・行整形・サイズ→表示の出し分けは `menuWidgetContent`
 * （純関数・テスト対象）に切り出し済みで、ここは組み立てるだけ。
 *
 * **サイズで出し分ける**（ペルソナ確定・§2）: 小/中=今日の一品を大きく、
 * 大=7 日分の週間一覧。タップは `clickAction=OPEN_URI` で、今日の一品/各行に
 * レシピ ID があればそのレシピ詳細、無ければ献立画面へ。
 *
 * ブランドカラーは `CLAUDE.md` §4 のパレット。padding は W1（ShoppingListWidget）
 * と同じく 12dp（設計 §4 の「クロップは余白 8dp+ で吸収」を満たす）。
 */
import { FlexWidget, TextWidget } from 'react-native-android-widget';

import type { WidgetSnapshot } from '../utils/widgetSnapshot';
import { buildMenuWidgetContent } from './menuWidgetContent';
import type { MenuWidgetSize } from './menuWidgetContent';

const COLORS = {
  background: '#0A0805',
  gold: '#C9A16A',
  text: '#DCC9A8',
  // 調理済みは薄く（設計 §2:「#2E2418 系」）。真っ黒だと読めないので少し起こす
  done: '#6B5B40',
  // 未定の「—」はグレー
  undecided: '#8A8175',
  // 「HH:mm 時点」— W1 と同じ faint（罫線色）で控えめに
  faint: '#2E2418',
} as const;

// クロップ吸収の余白（設計 §4）。8dp を下回らない（W1 と揃える）
const SAFE_PADDING = 12;

export interface MenuWidgetProps {
  snapshot: WidgetSnapshot | null;
  size: MenuWidgetSize;
}

export function MenuWidget({ snapshot, size }: MenuWidgetProps) {
  const content = buildMenuWidgetContent(snapshot, size);

  const timeLabel = content.timeLabel ? (
    <TextWidget
      text={content.timeLabel}
      style={{ color: COLORS.faint, fontSize: 10, marginTop: 6 }}
      maxLines={1}
    />
  ) : null;

  if (content.mode === 'week') {
    return (
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: content.uri }}
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
          text={content.heading}
          style={{ color: COLORS.gold, fontSize: 13, fontWeight: 'bold' }}
          maxLines={1}
        />

        {content.emptyMessage ? (
          <TextWidget
            text={content.emptyMessage}
            style={{ color: COLORS.text, fontSize: 12, marginTop: 8 }}
            maxLines={2}
          />
        ) : null}

        {content.rows.map((row, index) => (
          <TextWidget
            key={`${index}-${row.label}`}
            text={row.label}
            clickAction="OPEN_URI"
            clickActionData={{ uri: row.uri }}
            style={{
              color: row.isToday
                ? COLORS.gold
                : row.isUndecided
                  ? COLORS.undecided
                  : row.isDone
                    ? COLORS.done
                    : COLORS.text,
              fontSize: 12,
              fontWeight: row.isToday ? 'bold' : 'normal',
              marginTop: index === 0 ? 6 : 2,
            }}
            truncate="END"
            maxLines={1}
          />
        ))}

        {timeLabel}
      </FlexWidget>
    );
  }

  // 今日の一品（小/中）
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: content.uri }}
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
        text={content.heading}
        style={{ color: COLORS.gold, fontSize: 13, fontWeight: 'bold' }}
        maxLines={1}
      />

      {content.dishName ? (
        <TextWidget
          text={content.dishName}
          style={{ color: COLORS.text, fontSize: 18, fontWeight: 'bold', marginTop: 6 }}
          truncate="END"
          maxLines={2}
        />
      ) : null}

      {content.emptyMessage ? (
        <TextWidget
          text={content.emptyMessage}
          style={{ color: COLORS.text, fontSize: 12, marginTop: 8 }}
          maxLines={2}
        />
      ) : null}

      {timeLabel}
    </FlexWidget>
  );
}
