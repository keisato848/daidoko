/**
 * 同期で受信が適用されたら画面を読み直す（S1 — `docs/クラウド同期設計.md` §5-1b）。
 *
 * 画面は `useFocusEffect` で開くたびに読み直しているので、多くの場合これは要らない。
 * 要るのは「一覧を開いたまま、他端末の変更が届いたとき」— そこだけ埋める。
 *
 * `reload` の同一性は見ない（毎レンダーで作り直される関数が渡ってくるため）。
 * ref に最新を持ち、**適用の合図が変わったときだけ**呼ぶ。
 */
import { useEffect, useRef } from 'react';

import { useSyncStore } from '../stores/sync.store';

export function useSyncRefresh(reload: () => void): void {
  const lastAppliedAt = useSyncStore((state) => state.lastAppliedAt);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const seenRef = useRef(lastAppliedAt);

  useEffect(() => {
    if (lastAppliedAt === seenRef.current) return;
    seenRef.current = lastAppliedAt;
    reloadRef.current();
  }, [lastAppliedAt]);
}
