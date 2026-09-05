/**
 * 家族共有の招待リンク `https://<server>/j/:code`（および `daidoko://j/:code`）の受け口
 * （docs/クラウド同期設計.md §2-2b）。OS がアプリへ渡してきたら、家族グループ画面へ
 * コードを持って送るだけ。参加の確認と実行は家族画面が行う。
 */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function InviteLink() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return (
    <Redirect
      href={{
        pathname: '/family',
        params: { invite: typeof code === 'string' ? code : '' },
      }}
    />
  );
}
