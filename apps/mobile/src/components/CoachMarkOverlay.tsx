/**
 * Coach-mark overlay — dims the screen, highlights the current step's target
 * (cut-out via four dark panes), and shows a speech bubble with the guidance.
 * Steps without a measurable target show a centered bubble instead.
 */
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Colors } from '../constants/theme';
import { t } from '../i18n';

export interface CoachMarkStep {
  key: string;
  title: string;
  text: string;
  /** Screen coordinates of the highlighted element (null = centered bubble). */
  rect: { x: number; y: number; width: number; height: number } | null;
}

interface CoachMarkOverlayProps {
  visible: boolean;
  step: CoachMarkStep | null;
  index: number;
  total: number;
  onNext: () => void;
  onSkip: () => void;
}

const PADDING = 8;
const BUBBLE_MARGIN = 16;

export type CoachMarkRect = NonNullable<CoachMarkStep['rect']>;

/**
 * 吹き出しの位置。**対象が画面の上半分なら下に、下半分なら上に**出す。
 *
 * 以前は「下に 180px 空いていれば下」という固定値で判定していたが、吹き出しの高さは
 * 文言で変わる（4 行だと 380px を超える）。追加画面の 3 枚目（手動入力＝最下段のカード）で
 * 「はじめる」が画面の外に押し出された（Pixel 9a・2026-08-23）。
 * 半分で振り分ければ、どちら側にも最低で画面の半分の余白があり、文言の長さに左右されない。
 * 対象が無い（画面外・未描画）ときは中央やや上に出す。
 */
export function bubblePlacement(
  rect: CoachMarkRect | null,
  screenH: number,
): { top: number } | { bottom: number } {
  if (!rect) return { top: screenH * 0.38 };
  const centerY = rect.y + rect.height / 2;
  return centerY < screenH / 2
    ? { top: rect.y + rect.height + BUBBLE_MARGIN }
    : { bottom: screenH - rect.y + BUBBLE_MARGIN };
}

export function CoachMarkOverlay({
  visible,
  step,
  index,
  total,
  onNext,
  onSkip,
}: CoachMarkOverlayProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();

  if (!visible || !step) return null;

  const rect = step.rect
    ? {
        x: Math.max(0, step.rect.x - PADDING),
        y: Math.max(0, step.rect.y - PADDING),
        width: Math.min(screenW, step.rect.width + PADDING * 2),
        height: step.rect.height + PADDING * 2,
      }
    : null;

  const bubbleStyle = bubblePlacement(rect, screenH);

  const isLast = index >= total - 1;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onSkip}>
      <View style={styles.root}>
        {rect ? (
          <>
            {/* 4枚の暗幕で対象をくり抜く */}
            <View style={[styles.dim, { top: 0, left: 0, right: 0, height: rect.y }]} />
            <View
              style={[styles.dim, { top: rect.y, left: 0, width: rect.x, height: rect.height }]}
            />
            <View
              style={[
                styles.dim,
                {
                  top: rect.y,
                  left: rect.x + rect.width,
                  right: 0,
                  height: rect.height,
                },
              ]}
            />
            <View
              style={[styles.dim, { top: rect.y + rect.height, left: 0, right: 0, bottom: 0 }]}
            />
            <View
              style={[
                styles.highlightBorder,
                { top: rect.y, left: rect.x, width: rect.width, height: rect.height },
              ]}
              pointerEvents="none"
            />
          </>
        ) : (
          <View style={[styles.dim, StyleSheet.absoluteFillObject]} />
        )}

        <View style={[styles.bubble, bubbleStyle]}>
          <Text style={styles.bubbleTitle}>{step.title}</Text>
          <Text style={styles.bubbleText}>{step.text}</Text>
          <View style={styles.bubbleFooter}>
            <Text style={styles.progress}>
              {index + 1} / {total}
            </Text>
            <View style={styles.buttons}>
              {!isLast && (
                <Pressable
                  onPress={onSkip}
                  hitSlop={8}
                  accessibilityLabel={t('ui.coach.skipLabel')}
                >
                  <Text style={styles.skipText}>{t('ui.coach.skip')}</Text>
                </Pressable>
              )}
              <Pressable
                style={styles.nextButton}
                onPress={onNext}
                accessibilityLabel={isLast ? t('ui.coach.closeLabel') : t('ui.coach.nextLabel')}
              >
                <Text style={styles.nextText}>
                  {isLast ? t('ui.coach.start') : t('ui.coach.next')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(5, 4, 2, 0.82)',
  },
  highlightBorder: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: Colors.gold,
    borderRadius: 10,
  },
  bubble: {
    position: 'absolute',
    left: 24,
    right: 24,
    backgroundColor: '#1A1208',
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: 12,
    padding: 16,
  },
  bubbleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.gold,
    marginBottom: 6,
  },
  bubbleText: {
    fontSize: 14,
    fontWeight: '400',
    color: Colors.paper,
    lineHeight: 21,
  },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  progress: { fontSize: 12, color: Colors.muted },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  skipText: { fontSize: 13, color: Colors.muted },
  nextButton: {
    backgroundColor: Colors.gold,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
  },
  nextText: { fontSize: 13, fontWeight: '600', color: Colors.bg },
});
