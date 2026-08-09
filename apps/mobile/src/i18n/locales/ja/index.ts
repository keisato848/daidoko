/**
 * 日本語辞書。**これが原本**で、`../en` は `typeof ja` に縛られる（§3-2）。
 *
 * 700 件近くを 1 ファイルに置くと読めなくなるので、**名前空間ごとに分ける**。
 * 追加するときは対応する `../en/<名前空間>.ts` も同時に埋めること
 * （埋めないとコンパイルで落ちる — それが狙い）。
 */
import ai from './ai';
import backup from './backup';
import common from './common';
import error from './error';
import home from './home';
import log from './log';
import recipe from './recipe';
import settings from './settings';

const ja = {
  ai,
  backup,
  common,
  error,
  home,
  log,
  recipe,
  settings,
};

export default ja;
