/**
 * ダイアログの置き場所（`docs/画面設計.md` §7-3）。
 *
 * `app/_layout.tsx` に **1 つだけ** 置く。キューの先頭を描き、押されたら解決して次へ進む。
 * これが居ないと `dialog.alert()` 等は却下側の値で即座に解決する（service 側で判定）。
 *
 * **開いているシートの上に重ねないこと。** RN の `<Modal>` は入れ子にすると iOS で
 * 表示に失敗しうるので、シート内の操作が失敗したときは先にシートを閉じる（§7-4）。
 */
import { useEffect } from 'react';

import { AppDialog } from './AppDialog';
import { useDialogStore } from '../stores/dialog.store';

export function DialogHost() {
  const head = useDialogStore((state) => state.queue[0]);
  const settleHead = useDialogStore((state) => state.settleHead);
  const setHostMounted = useDialogStore((state) => state.setHostMounted);

  useEffect(() => {
    setHostMounted(true);
    return () => setHostMounted(false);
  }, [setHostMounted]);

  if (!head) return null;

  return (
    <AppDialog
      // 文言が同じダイアログが続けて出たときに、前の描画を使い回さない
      key={head.id}
      layout={head.layout}
      title={head.title}
      {...(head.message !== undefined ? { message: head.message } : {})}
      buttons={head.buttons}
      onPress={settleHead}
      onDismiss={() => settleHead(head.dismissIndex)}
    />
  );
}
