/**
 * 入力欄の**下に続くボタン**がキーボードに隠れないスクロール。
 *
 * なぜ要るか（実機 AQUOS SH-RM19s で再現した不具合）:
 * レシピ作成の「材料名」にフォーカスすると、Android は**その欄がぎりぎり見える位置**まで
 * スクロールする。`KeyboardAvoider` は領域をキーボードの上端で切るので、
 * 入力欄の下端＝キーボードの上端になり、**直下の「+ 材料を追加」に 1px も残らない**。
 * 材料を 1 つ打って次を足したいのに、キーボードを閉じてスクロールし直す往復が要った。
 * 「手順を追加」も同じ形。
 *
 * `bottomOffset` が「フォーカスした欄とキーボードの間に空ける距離」なので、
 * **直後のボタン 1 個ぶん**を既定にしてある。行の下に何も無い画面では
 * `KeyboardAvoider` のままでよい（余計な余白が出るだけ）。
 */
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import type { ComponentProps } from 'react';

/** 「追加」ボタン 1 個ぶん（高さ + 余白）。行の直下に置かれる想定。 */
export const FOLLOWING_ACTION_SPACE = 96;

type Props = ComponentProps<typeof KeyboardAwareScrollView>;

export function KeyboardAwareScroll({ bottomOffset, children, ...rest }: Props) {
  return (
    <KeyboardAwareScrollView bottomOffset={bottomOffset ?? FOLLOWING_ACTION_SPACE} {...rest}>
      {children}
    </KeyboardAwareScrollView>
  );
}
