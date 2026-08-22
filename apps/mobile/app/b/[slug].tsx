/**
 * 共有リンク `https://<server>/b/:slug` の受け口（#198 App Links / Universal Links）。
 * OS がアプリへ渡してきたら、取り込み画面へ送るだけ。
 */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function ShareBookLink() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  return (
    <Redirect
      href={{
        pathname: '/(tabs)/recipes/import-share',
        params: { kind: 'book', slug: typeof slug === 'string' ? slug : '' },
      }}
    />
  );
}
