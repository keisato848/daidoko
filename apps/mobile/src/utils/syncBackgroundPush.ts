/**
 * 家族の変更を「アプリを開かずに」ウィジェットへ映すための、見えない push の見分け（受付票 D-3）。
 *
 * サーバーは家族の変更 1 回につき push を **2 通**送る:
 * - 見える通知（`type: 'sync'`・固定文）… 従来どおり。アプリが前面なら受信時に同期する
 * - **見えない通知（`type: 'sync-bg'`・題名も本文も無い）** … これだけが、アプリが終了していても
 *   JS（背景タスク）を起こせる。Android は data だけの push でないと背景タスクが走らず、
 *   iOS は `_contentAvailable` が要る（Expo の仕様。`docs/ウィジェット設計.md` §11）
 *
 * 背景タスクに渡る `data` の形は **OS と Expo の版で違う**（Android は `data.body` に JSON 文字列、
 * iOS は `data` 直下や `aps` の隣、前面で受けたときは `notification.request.content.data`）。
 * 取りこぼすと「届いているのに何も起きない」になり、実機でしか気づけないので、
 * 知られている置き場所を全部見る。**知らない形は false**（関係ない push で同期を走らせない）。
 */
export const SYNC_BACKGROUND_PUSH_TYPE = 'sync-bg';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** `type` を持っていそうな場所を、深さを限って順に見る（循環・巨大な入れ子で固まらない） */
function candidates(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const data = payload['data'];
  const notification = payload['notification'];
  const out: unknown[] = [
    payload,
    data,
    parseJson(payload['body']),
    parseJson(payload['dataString']),
  ];
  if (isRecord(data)) {
    out.push(data['data'], parseJson(data['body']), parseJson(data['dataString']));
  }
  if (isRecord(notification)) {
    out.push(notification['data']);
    const request = notification['request'];
    if (isRecord(request) && isRecord(request['content'])) out.push(request['content']['data']);
  }
  return out;
}

/** 背景タスクに渡ってきたものが、家族同期の見えない push か */
export function isSyncBackgroundPayload(payload: unknown): boolean {
  return candidates(payload).some((c) => isRecord(c) && c['type'] === SYNC_BACKGROUND_PUSH_TYPE);
}
