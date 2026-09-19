import { isSyncBackgroundPayload } from '../syncBackgroundPush';

/**
 * 背景タスクに渡る push の中身は OS と Expo の版で形が違う。取りこぼすと
 * 「届いているのに何も起きない」になり、実機でしか気づけない。知られている形を全部固定する。
 */
describe('isSyncBackgroundPayload', () => {
  it.each([
    ['Android の背景タスク: data.body に JSON 文字列', { data: { body: '{"type":"sync-bg"}' } }],
    ['Android の別形: data.dataString', { data: { dataString: '{"type":"sync-bg"}' } }],
    ['iOS の背景タスク: data 直下', { data: { type: 'sync-bg' }, aps: { 'content-available': 1 } }],
    ['入れ子: data.data', { data: { data: { type: 'sync-bg' } } }],
    ['最上位に直接', { type: 'sync-bg' }],
    ['最上位の body に JSON 文字列', { body: '{"type":"sync-bg"}' }],
    [
      '前面で受けた通知オブジェクト',
      { notification: { request: { content: { data: { type: 'sync-bg' } } } } },
    ],
    ['notification.data', { notification: { data: { type: 'sync-bg' } } }],
  ])('%s → true', (_name, payload) => {
    expect(isSyncBackgroundPayload(payload)).toBe(true);
  });

  it.each([
    ['見える同期通知（sync）は対象外 — 前面の listener が扱う', { data: { type: 'sync' } }],
    ['献立の通知（menu）', { data: { body: '{"type":"menu","jobId":"x"}' } }],
    ['type が無い', { data: { body: '{"hello":1}' } }],
    ['壊れた JSON', { data: { body: '{not json' } }],
    ['文字列そのもの', 'sync-bg'],
    ['null', null],
    ['undefined', undefined],
    ['配列', [{ type: 'sync-bg' }]],
    ['値が部分一致するだけ', { data: { type: 'sync-bg-extra' } }],
  ])('%s → false（関係ない push で同期を走らせない）', (_name, payload) => {
    expect(isSyncBackgroundPayload(payload)).toBe(false);
  });
});
