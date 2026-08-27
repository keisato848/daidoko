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
import ads from './ads';
import backup from './backup';
import byok from './byok';
import common from './common';
import error from './error';
import family from './family';
import home from './home';
import log from './log';
import notification from './notification';
import menu from './menu';
import pantry from './pantry';
import paywall from './paywall';
import recipe from './recipe';
import recipeImport from './recipeImport';
import settings from './settings';
import ui from './ui';

const en: typeof jaDict = {
  ads,
  ai,
  backup,
  byok,
  common,
  error,
  family,
  home,
  log,
  notification,
  menu,
  pantry,
  paywall,
  recipe,
  recipeImport,
  settings,
  ui,
};

export default en;
