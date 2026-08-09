/**
 * 英語辞書。**`typeof ja` に縛られる**ので、キーの抜けはコンパイルで落ちる（§3-2）。
 *
 * ただし型は**中身の正しさを見ない**。空文字でも意味の違う文でも型は通るため、
 * A 階層は `__tests__/semantics.test.ts` で意味の同一性を検査する（§6-5）。
 *
 * 各文言の `intent`（ja 側に記載）を読んでから書くこと。
 */
import type jaDict from '../ja';

import ai from './ai';
import backup from './backup';
import common from './common';
import error from './error';
import home from './home';
import log from './log';
import recipe from './recipe';

const en: typeof jaDict = {
  ai,
  backup,
  common,
  error,
  home,
  log,
  recipe,
};

export default en;
