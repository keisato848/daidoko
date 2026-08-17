/**
 * キーボードでボタンが隠れないようにする共通ラッパー。
 *
 * 中身は `react-native-keyboard-controller` の `KeyboardAvoidingView`。
 * React Native 標準のものは**キーボードの開閉を「点」でしか見ない**（`keyboardDidShow` /
 * `keyboardDidHide`）ため、Android の edge-to-edge（SDK 54 で強制）ではウィンドウが
 * リサイズされず高さがずれる・追従がガタつく、という問題があった。
 * こちらはフレーム単位で追従するので、`behavior` の指定に頼らずに正しい余白が入る。
 *
 * **ルートに `KeyboardProvider` が要る**（`app/_layout.tsx`）。無いと黙って何もしない。
 *
 * 入力欄のある画面は必ずこれで包む。個々の画面で `KeyboardAvoidingView` を
 * 直に使うと、また指定漏れが起きる。
 * **この規約は `__tests__/keyboard-avoider-coverage.test.ts` が機械的に見張る**
 * （文章で書いただけの頃、主役の「写真からレシピ」を含む 5 画面が漏れていた — #172）。
 *
 * `Modal` の中身は画面本体とは**別のツリー**なので、画面を包んでもモーダル内には
 * 効かない。モーダルの内側にも個別に置くこと。
 *
 * **スクロールの中に入力欄と、その下に続くボタン（「材料を追加」等）がある画面は
 * これではなく `KeyboardAwareScroll` を使う。** こちらは領域を縮めるだけなので、
 * Android がフォーカス欄を「ぎりぎり見える位置」まで送った結果、直下のボタンが
 * キーボードの下に残る（実機 AQUOS で再現・レシピ作成の「材料を追加」）。
 */
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { StyleSheet, type ViewStyle } from 'react-native';

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
