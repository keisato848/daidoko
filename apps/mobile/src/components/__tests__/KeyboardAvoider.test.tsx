/**
 * キーボードでボタンが隠れる問題の回帰止め。
 *
 * 実装は `react-native-keyboard-controller` の `KeyboardAvoidingView`（フレーム追従）。
 * Android の edge-to-edge ではウィンドウがリサイズされないため、`behavior` を
 * 未指定に戻すとただの View になり、画面下端のボタンがキーボードの下に隠れる。
 * 実機 AQUOS SH-RM19s (Android 13) とエミュレータ API 36 の両方で再現した。
 *
 * jest では同ライブラリのモックが `KeyboardAvoidingView` を素の `View` に差し替えるので、
 * 型で引くと最初の一致＝このコンポーネントのルートになる。
 */
import { render } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { KeyboardAvoider } from '../KeyboardAvoider';

function renderAvoider(offset?: number) {
  const tree = render(
    <KeyboardAvoider {...(offset === undefined ? {} : { offset })}>
      <Text>child</Text>
    </KeyboardAvoider>,
  );
  return { tree, avoider: tree.UNSAFE_getAllByType(KeyboardAvoidingView)[0] };
}

describe('KeyboardAvoider', () => {
  it('behavior を padding で渡す（未指定にすると Android でボタンが隠れる）', () => {
    expect(renderAvoider().avoider?.props.behavior).toBe('padding');
  });

  it('子をそのまま描画する', () => {
    expect(renderAvoider().tree.getByText('child')).toBeTruthy();
  });

  it('offset を渡せる（ヘッダーぶんを差し引く画面向け）', () => {
    expect(renderAvoider(54).avoider?.props.keyboardVerticalOffset).toBe(54);
  });
});
