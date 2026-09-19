/**
 * ActionToast — ルートレベルに 1 つだけマウントする確認付き Toast。
 *
 * 既存の `Toast.tsx` とは別コンポーネント。17 画面が使う Toast は 1 行も変えない。
 *
 * 表示パターン:
 * - メッセージのみ → 4 秒後に自動消去
 * - 取り消しボタン付き → 8 秒後に自動消去
 * - `durationMs` を明示すればそちらに従う
 *
 * アニメーションは既存 `Toast.tsx` と同じ（`Animated` で 200ms fade-in/out）。
 * 構成は `CookingResumeBar.tsx` に倣う（store の状態を読んで null なら描画しない）。
 */
import { useCallback, useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';
import { useActionToastStore } from '../stores/action-toast.store';

/** 既定の自動消去ミリ秒 */
const DEFAULT_DURATION_MS = 4_000;
/** 取り消しボタン付きの既定ミリ秒 */
const UNDO_DURATION_MS = 8_000;

export function ActionToast() {
  const current = useActionToastStore((s) => s.current);
  const dismiss = useActionToastStore((s) => s.dismiss);
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fadeOut = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      dismiss();
    });
  }, [opacity, dismiss]);

  useEffect(() => {
    if (!current) {
      // payload がクリアされたらアニメーションもリセット
      opacity.setValue(0);
      clearTimer();
      return;
    }

    // fade-in
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    // 自動消去タイマー
    const duration =
      current.durationMs ?? (current.action ? UNDO_DURATION_MS : DEFAULT_DURATION_MS);
    clearTimer();
    timerRef.current = setTimeout(() => {
      fadeOut();
    }, duration);

    return () => {
      clearTimer();
    };
  }, [current, opacity, clearTimer, fadeOut]);

  if (!current) return null;

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <Text style={styles.text}>{current.message}</Text>
      {current.action && (
        <View style={styles.actionWrapper}>
          <Pressable
            onPress={() => {
              clearTimer();
              current.action?.onPress();
              fadeOut();
            }}
            accessibilityRole="button"
          >
            <Text style={styles.actionLabel}>{current.action.label}</Text>
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  text: {
    fontSize: Typography.size.sm,
    color: Colors.paper,
    flex: 1,
  },
  actionWrapper: {
    marginLeft: 12,
  },
  actionLabel: {
    fontSize: Typography.size.sm,
    fontWeight: '700',
    color: Colors.gold,
  },
});
