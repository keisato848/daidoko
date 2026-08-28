/**
 * ボトムタブが下の safe-area を確保しているか（2026-08-27 に露見）。
 *
 * `tabBarStyle` に `height` を直書きすると、`@react-navigation/bottom-tabs` の
 * `getTabBarHeight` がその値を見つけた時点で return してしまい、
 * **`TABBAR_HEIGHT_UIKIT + inset` の行に到達しない**。それでいて
 * `paddingBottom: insets.bottom` は別レイヤで効き続けるので、中身の入る高さが
 * `height - paddingTop - insets.bottom` まで潰れ、ラベルが下端で切れる。
 *
 * **日本語のラベルにはディセンダ（p・y・g の下に出る部分）が無いので見た目では気づけない。**
 * App Store 用に英語で撮って初めて分かった（Recipes / Pantry / Shopping が切れていた）。
 * Android では公開中の日本語スクショでも、ジェスチャーバーの白い横棒が
 * 「追加」を横切ったまま 1.12.1 まで出ていた。
 */
import { render } from '@testing-library/react-native';
import type { ViewStyle } from 'react-native';

import TabLayout from '../_layout';

/** アイコン（24px）とラベル（9px）が収まるのに要る最低限。 */
const MIN_CONTENT_HEIGHT = 50;

type ScreenOptions = { tabBarStyle?: ViewStyle };
type ScreenProps = {
  name?: string;
  options?: ScreenOptions | ((arg: { route: { name: string } }) => ScreenOptions);
};

const mockCaptured: { screenOptions?: ScreenOptions; children?: unknown } = {};

jest.mock('expo-router', () => {
  const Tabs = (props: { screenOptions?: ScreenOptions; children?: unknown }) => {
    mockCaptured.screenOptions = props.screenOptions;
    mockCaptured.children = props.children;
    return null;
  };
  Tabs.Screen = () => null;
  return { Tabs };
});

jest.mock('react-native-safe-area-context', () => {
  // 端末ごとに変えて確かめたいので、ファクトリの中に可変の実体を持つ
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  return {
    useSafeAreaInsets: () => insets,
    __setBottomInset: (value: number) => {
      insets.bottom = value;
    },
  };
});

const { __setBottomInset: setBottomInset } = jest.requireMock('react-native-safe-area-context') as {
  __setBottomInset: (value: number) => void;
};

/** 下インセットを与えて描画し、既定の tabBarStyle を返す。 */
function tabBarStyleWithInset(bottom: number): ViewStyle {
  setBottomInset(bottom);
  mockCaptured.screenOptions = undefined;
  mockCaptured.children = undefined;
  render(<TabLayout />);
  const style = mockCaptured.screenOptions?.tabBarStyle;
  expect(style).toBeDefined();
  return style as ViewStyle;
}

/**
 * アイコンとラベルが実際に入る高さ。
 *
 * `paddingBottom` を自前で指定していなければ React Navigation が `insets.bottom` を
 * 入れるので、省略時はインセットぶんが引かれるものとして数える。
 */
function contentHeightOf(style: ViewStyle, insetBottom: number): number {
  const paddingBottom = Number(style.paddingBottom ?? insetBottom);
  return Number(style.height) - paddingBottom - Number(style.paddingTop ?? 0);
}

describe('ボトムタブの下 safe-area', () => {
  it('高さが下インセットぶん伸びる', () => {
    // **これが本丸。** `height` を固定値で書くと差が 0 になってここが落ちる。
    const flat = tabBarStyleWithInset(0);
    const gesture = tabBarStyleWithInset(34);
    expect(Number(gesture.height) - Number(flat.height)).toBe(34);
  });

  it('ジェスチャーバーのある端末でもラベルぶんの高さが残る', () => {
    const style = tabBarStyleWithInset(34);
    expect(contentHeightOf(style, 34)).toBeGreaterThanOrEqual(MIN_CONTENT_HEIGHT);
  });

  it('インセットの無い端末でもラベルぶんの高さが残る', () => {
    const style = tabBarStyleWithInset(0);
    expect(contentHeightOf(style, 0)).toBeGreaterThanOrEqual(MIN_CONTENT_HEIGHT);
  });

  it('レシピタブの上書きでも同じだけ残る', () => {
    // recipes は撮影画面でタブバーを隠すために options を関数で持つ。
    // **既定と別経路なので、片方だけ直すともう片方が壊れる。**
    tabBarStyleWithInset(34);
    const children = Array.isArray(mockCaptured.children)
      ? (mockCaptured.children as { props?: ScreenProps }[])
      : [];
    const recipes = children.find((c) => c?.props?.name === 'recipes');
    expect(recipes).toBeDefined();

    const options = recipes?.props?.options;
    expect(typeof options).toBe('function');
    const resolved = (options as (arg: { route: { name: string } }) => ScreenOptions)({
      route: { name: 'recipes' },
    });
    expect(resolved.tabBarStyle).toBeDefined();
    expect(contentHeightOf(resolved.tabBarStyle as ViewStyle, 34)).toBeGreaterThanOrEqual(
      MIN_CONTENT_HEIGHT,
    );
  });
});
