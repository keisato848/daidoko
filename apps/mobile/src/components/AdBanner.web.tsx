/**
 * Web スタブ。react-native-google-mobile-ads はネイティブ専用なので、
 * Web バンドルには何も描画しないコンポーネントを渡す。
 */
export function shouldShowBanner(): boolean {
  return false;
}

export function AdBanner() {
  return null;
}
