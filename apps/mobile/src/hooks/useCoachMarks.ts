/**
 * useCoachMarks — first-run coach marks for a screen. On focus, if the screen's
 * marks haven't been seen, measures the target refs and steps through them.
 * Targets that can't be measured (conditional UI not rendered) fall back to a
 * centered bubble. Completion (or skip) marks the screen as seen.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type RefObject } from 'react';
import { Dimensions, type View } from 'react-native';

import type { CoachMarkStep } from '../components/CoachMarkOverlay';
import {
  markCoachMarksSeen,
  shouldShowCoachMarks,
  type CoachMarkScreen,
} from '../services/coach-marks.service';

export interface CoachMarkStepDef {
  key: string;
  title: string;
  text: string;
  /** Ref to the highlighted element; omit for a centered message. */
  ref?: RefObject<View | null>;
}

const MEASURE_DELAY_MS = 550; // レイアウト・遷移アニメーションの完了待ち

function measureStep(def: CoachMarkStepDef): Promise<CoachMarkStep> {
  return new Promise((resolve) => {
    const node = def.ref?.current;
    if (!node) {
      resolve({ key: def.key, title: def.title, text: def.text, rect: null });
      return;
    }
    // measure() の pageX/pageY はスクリーン絶対座標（ステータスバー込み）なので、
    // statusBarTranslucent なフルスクリーン Modal の座標系と一致する
    // （measureInWindow はウィンドウ相対で、ステータスバー分ずれる端末がある）。
    node.measure((_x, _y, width, height, pageX, pageY) => {
      const screen = Dimensions.get('screen');
      const inViewport =
        Number.isFinite(pageX) &&
        Number.isFinite(pageY) &&
        width > 0 &&
        height > 0 &&
        pageY >= 0 &&
        pageY + height <= screen.height;
      // スクロールで画面外の対象は中央吹き出しにフォールバック
      const rect = inViewport ? { x: pageX, y: pageY, width, height } : null;
      resolve({ key: def.key, title: def.title, text: def.text, rect });
    });
  });
}

export function useCoachMarks(screen: CoachMarkScreen, defs: CoachMarkStepDef[], enabled = true) {
  const [steps, setSteps] = useState<CoachMarkStep[] | null>(null);
  const [index, setIndex] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      shouldShowCoachMarks(screen)
        .then((show) => {
          if (!show || cancelled) return;
          timer = setTimeout(() => {
            void Promise.all(defs.map(measureStep)).then((measured) => {
              if (cancelled) return;
              setIndex(0);
              setSteps(measured);
            });
          }, MEASURE_DELAY_MS);
        })
        .catch(() => undefined);

      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
      // defs は画面ごとに静的（リテラル配列）なので screen/enabled のみ依存にする
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screen, enabled]),
  );

  const dismiss = useCallback(() => {
    setSteps(null);
    markCoachMarksSeen(screen).catch(() => undefined);
  }, [screen]);

  const next = useCallback(() => {
    setIndex((prev) => {
      if (steps && prev + 1 < steps.length) return prev + 1;
      dismiss();
      return prev;
    });
  }, [steps, dismiss]);

  // ヘルプボタン（?）からの手動再生 — 表示済みフラグに関係なく即時に測定して表示
  const show = useCallback(() => {
    void Promise.all(defs.map(measureStep)).then((measured) => {
      setIndex(0);
      setSteps(measured);
    });
    // defs は画面ごとに静的（リテラル配列）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    visible: steps != null,
    step: steps?.[index] ?? null,
    index,
    total: steps?.length ?? 0,
    next,
    skip: dismiss,
    show,
  };
}
