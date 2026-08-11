/**
 * キーボードでボタンが隠れないようにする共通ラッパー。
 *
 * **`behavior` を Android で未指定にしてはいけない。**
 * `AndroidManifest` は `adjustResize` を指定しているが、この構成では
 * **ウィンドウがリサイズされず**、ソフトキーボードが画面の上に重なるだけになる。
 * その状態で `behavior=undefined` にすると `KeyboardAvoidingView` はただの View になり、
 * 画面下端のボタン（送信・保存・変換）がキーボードの下に完全に隠れる。
 * 実機 AQUOS SH-RM19s (Android 13) とエミュレータ API 36 の両方で再現する。
 *
 * そのため **両プラットフォームで `padding`** を使う。RN はキーボードの高さを
 * `keyboardDidShow` で通知するので、リサイズされない環境でも正しく余白が入る。
 *
 * 入力欄のある画面は必ずこれで包む。個々の画面で `KeyboardAvoidingView` を
 * 直に使うと、また `behavior` の指定漏れが起きる。
 */
import { KeyboardAvoidingView, StyleSheet, type ViewStyle } from 'react-native';

interface KeyboardAvoiderProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /**
   * ヘッダーなど、キーボードの高さから差し引きたい分。
   * 既定 0（画面全体を包む前提）。
   */
  offset?: number;
}

export function KeyboardAvoider({ children, style, offset = 0 }: KeyboardAvoiderProps) {
  return (
    <KeyboardAvoidingView
      style={[styles.fill, style]}
      behavior="padding"
      keyboardVerticalOffset={offset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
