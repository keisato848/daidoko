/**
 * 命令的ダイアログ API（`docs/画面設計.md` §7-3）。
 *
 * ここで守るのは **`confirm` が「はい」以外で必ず false になる**こと。
 * 却下・背景タップ・ホスト不在のどれか 1 つでも true に倒れると、
 * 確認を出さないまま削除が走る。
 */
import { dialog } from '../dialog.service';
import { resetDialogStoreForTesting, useDialogStore } from '../../stores/dialog.store';

/** ホストの代わりにキューの先頭を読む。 */
function head() {
  const entry = useDialogStore.getState().queue[0];
  if (!entry) throw new Error('キューが空です');
  return entry;
}

/** ホストがボタンを押したことにする。 */
function press(index: number): void {
  useDialogStore.getState().settleHead(index);
}

/** ホストが背景タップ・戻るキーを受けたことにする。 */
function dismiss(): void {
  const entry = head();
  useDialogStore.getState().settleHead(entry.dismissIndex);
}

describe('dialog', () => {
  beforeEach(() => {
    resetDialogStoreForTesting();
    useDialogStore.getState().setHostMounted(true);
  });

  describe('alert', () => {
    it('中央カードに OK だけを出し、押すと解決する', async () => {
      const pending = dialog.alert({ title: '保存しました', message: '保存しました。' });
      expect(head().layout).toBe('card');
      expect(head().buttons).toEqual([{ label: 'OK', tone: 'primary' }]);
      press(0);
      await expect(pending).resolves.toBeUndefined();
    });

    it('背景タップでも OK と同じく解決する', async () => {
      const pending = dialog.alert({ title: '通信できません' });
      dismiss();
      await expect(pending).resolves.toBeUndefined();
    });

    it('本文を渡さなければ message を持たない（exactOptionalPropertyTypes 対策）', () => {
      void dialog.alert({ title: '通信できません' });
      expect('message' in head()).toBe(false);
    });
  });

  describe('confirm', () => {
    it('ボトムシートに「キャンセル / 実行」の順で出す', () => {
      void dialog.confirm({ title: 'レシピを削除', confirmLabel: '削除', destructive: true });
      expect(head().layout).toBe('sheet');
      expect(head().buttons).toEqual([
        { label: 'キャンセル', tone: 'default' },
        { label: '削除', tone: 'destructive' },
      ]);
    });

    it('破壊的でなければ実行ボタンはゴールド', () => {
      void dialog.confirm({ title: '公開しますか' });
      expect(head().buttons[1].tone).toBe('primary');
    });

    it('実行を押したときだけ true', async () => {
      const pending = dialog.confirm({ title: 'レシピを削除' });
      press(1);
      await expect(pending).resolves.toBe(true);
    });

    it('キャンセルを押したら false', async () => {
      const pending = dialog.confirm({ title: 'レシピを削除' });
      press(0);
      await expect(pending).resolves.toBe(false);
    });

    it('背景タップ・戻るキーはキャンセル側に倒す', async () => {
      const pending = dialog.confirm({ title: 'レシピを削除' });
      expect(head().dismissIndex).toBe(0);
      dismiss();
      await expect(pending).resolves.toBe(false);
    });
  });

  describe('choose', () => {
    const options = [
      { label: 'メートル法', value: 'metric' as const },
      { label: 'ヤード・ポンド法', value: 'imperial' as const },
    ];

    it('選択肢のあとにキャンセルを置く', () => {
      void dialog.choose({ title: '単位系', options });
      expect(head().buttons.map((button) => button.label)).toEqual([
        'メートル法',
        'ヤード・ポンド法',
        'キャンセル',
      ]);
      expect(head().dismissIndex).toBe(2);
    });

    it('選んだ値を返す', async () => {
      const pending = dialog.choose({ title: '単位系', options });
      press(1);
      await expect(pending).resolves.toBe('imperial');
    });

    it('キャンセル・却下はどちらも null', async () => {
      const cancelled = dialog.choose({ title: '単位系', options });
      press(2);
      await expect(cancelled).resolves.toBeNull();

      const dismissed = dialog.choose({ title: '単位系', options });
      dismiss();
      await expect(dismissed).resolves.toBeNull();
    });
  });

  describe('積み上がったとき', () => {
    it('先に積んだ順で 1 つずつ出す（後の 1 件を落とさない）', async () => {
      const first = dialog.confirm({ title: '1つ目' });
      const second = dialog.confirm({ title: '2つ目' });
      expect(useDialogStore.getState().queue).toHaveLength(2);

      expect(head().title).toBe('1つ目');
      press(1);
      await expect(first).resolves.toBe(true);

      expect(head().title).toBe('2つ目');
      press(0);
      await expect(second).resolves.toBe(false);
      expect(useDialogStore.getState().queue).toHaveLength(0);
    });
  });

  describe('DialogHost が居ないとき', () => {
    beforeEach(() => {
      resetDialogStoreForTesting();
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('confirm は false（確認を出せないまま破壊させない）', async () => {
      await expect(dialog.confirm({ title: 'レシピを削除' })).resolves.toBe(false);
      expect(useDialogStore.getState().queue).toHaveLength(0);
    });

    it('choose は null・alert は素通り', async () => {
      await expect(dialog.choose({ title: '単位系', options: [] })).resolves.toBeNull();
      await expect(dialog.alert({ title: '通信できません' })).resolves.toBeUndefined();
    });

    it('配線漏れに気づけるよう警告を出す', () => {
      void dialog.confirm({ title: 'レシピを削除' });
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('DialogHost'));
    });

    it('表示中にホストが外れたら待っている Promise を却下側で解決する', async () => {
      useDialogStore.getState().setHostMounted(true);
      const pending = dialog.confirm({ title: 'レシピを削除' });
      useDialogStore.getState().setHostMounted(false);
      await expect(pending).resolves.toBe(false);
    });
  });
});
