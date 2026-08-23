/**
 * アプリのデザインのダイアログを**命令的に**出す（`docs/画面設計.md` §7-3）。
 *
 * `Alert.alert` の置き換え。フックではなくモジュール関数にしてあるのは 2 つの理由から:
 *
 * 1. `inference-gate.service` は画面ではないのに広告視聴の確認を出す。
 *    JSX を返せない場所から呼べる必要がある
 * 2. 呼び出し元の多くは `useCallback` の中にあり、フックにすると依存配列の書き換えが
 *    全画面に波及する。モジュール関数なら `Alert.alert` の素直な置き換えで済む
 *
 * **`DialogHost` が画面に居ないときは却下側の値を返す**（`confirm` → `false`、
 * `choose` → `null`）。Promise を宙に浮かせると呼び出し側が固まり、`true` を返すと
 * 「確認を出せていないのに破壊が走る」ことになる。
 */
import type { DialogButton, DialogLayout, DialogTone } from '../components/AppDialog';
import { t } from '../i18n';
import { useDialogStore } from '../stores/dialog.store';

export interface AlertOptions {
  title: string;
  message?: string;
  /** 既定は「OK」 */
  okLabel?: string;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** 既定は「確認」 */
  confirmLabel?: string;
  /** 既定は「キャンセル」 */
  cancelLabel?: string;
  /** 消える・戻せない操作なら true。実行ボタンが赤くなる */
  destructive?: boolean;
}

export interface DialogChoice<T> {
  label: string;
  value: T;
  /** 既定は `default`（枠だけ）。1 つだけ強調したいときに `primary` を指す */
  tone?: DialogTone;
}

export interface ChooseOptions<T> {
  title: string;
  message?: string;
  options: readonly DialogChoice<T>[];
  /** 既定は「キャンセル」 */
  cancelLabel?: string;
}

interface PresentInput {
  layout: DialogLayout;
  title: string;
  message?: string;
  buttons: readonly DialogButton[];
  dismissIndex: number | null;
}

function present(input: PresentInput): Promise<number | null> {
  const store = useDialogStore.getState();
  if (!store.hostMounted) {
    // 配線漏れ（`app/_layout.tsx` に DialogHost が無い）。黙って進めると
    // 確認なしで破壊的操作が走るので、却下側で解決したうえで気づけるようにする
    if (__DEV__) {
      // 開発者向けの警告なので英語で書く（画面には出ない・辞書に入れない）
      console.warn(`[dialog] DialogHost is not mounted; dismissing: ${input.title}`);
    }
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    store.enqueue({ ...input, settle: resolve });
  });
}

/** 通知（OK のみ）。画面中央のカードで出る。 */
async function alert(options: AlertOptions): Promise<void> {
  await present({
    layout: 'card',
    title: options.title,
    ...(options.message !== undefined ? { message: options.message } : {}),
    buttons: [{ label: options.okLabel ?? t('common.ok'), tone: 'primary' }],
    // 背景タップ = OK。読んで閉じるだけなので区別しない
    dismissIndex: 0,
  });
}

/** 2 択の確認。ボトムシートで出る。`true` なら実行してよい。 */
async function confirm(options: ConfirmOptions): Promise<boolean> {
  const picked = await present({
    layout: 'sheet',
    title: options.title,
    ...(options.message !== undefined ? { message: options.message } : {}),
    buttons: [
      { label: options.cancelLabel ?? t('common.cancel'), tone: 'default' },
      {
        label: options.confirmLabel ?? t('ui.confirm.title'),
        tone: options.destructive === true ? 'destructive' : 'primary',
      },
    ],
    // 背景タップ・戻るキーはキャンセル側（実行しない方）に倒す
    dismissIndex: 0,
  });
  return picked === 1;
}

/** 3 つ以上から選ぶ。ボトムシートに縦積みで出る。選ばなければ `null`。 */
async function choose<T>(options: ChooseOptions<T>): Promise<T | null> {
  const cancelIndex = options.options.length;
  const picked = await present({
    layout: 'sheet',
    title: options.title,
    ...(options.message !== undefined ? { message: options.message } : {}),
    buttons: [
      ...options.options.map((option) => ({
        label: option.label,
        tone: option.tone ?? ('default' as DialogTone),
      })),
      // キャンセルは最下段（§7-2）
      { label: options.cancelLabel ?? t('common.cancel'), tone: 'default' as DialogTone },
    ],
    dismissIndex: cancelIndex,
  });
  if (picked === null || picked === cancelIndex) return null;
  return options.options[picked].value;
}

export const dialog = { alert, confirm, choose };
