/**
 * 日本語辞書。**これが原本**で、`../en` は `typeof ja` に縛られる（§3-2）。
 *
 * 700 件近くを 1 ファイルに置くと読めなくなるので、**名前空間ごとに分ける**。
 * 追加するときは対応する `../en/<名前空間>.ts` も同時に埋めること
 * （埋めないとコンパイルで落ちる — それが狙い）。
 */
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

const ja = {
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

export default ja;
