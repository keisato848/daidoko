/**
 * 相談に添えた写真の扱い。
 *
 * **ここで守るのは「送る写真を新しい方から絞る」こと。** 会話が伸びるほど過去の写真が
 * 積み上がり、毎回の往復で全部送ると入力トークンが会話の長さに比例して膨らむ。
 * 古い写真は assistant の返答に言葉として残っているので、落としても文脈は途切れにくい。
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_CONSULT_IMAGES,
  pickRecentImages,
  type ConsultMessage,
} from '../lib/recipe-consult.js';

function image(tag: string) {
  return { imageBase64: tag, mimeType: 'image/jpeg' };
}

function user(text: string, images?: { imageBase64: string; mimeType: string }[]): ConsultMessage {
  return images ? { role: 'user', text, images } : { role: 'user', text };
}

function assistant(text: string): ConsultMessage {
  return { role: 'assistant', text };
}

/** 残った写真を「添字:タグ」の一覧にして比べやすくする。 */
function taggedKept(messages: ConsultMessage[], max?: number): string[] {
  const kept = pickRecentImages(messages, max);
  return [...kept.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([index, images]) => images.map((img) => `${index}:${img.imageBase64}`));
}

describe('pickRecentImages', () => {
  it('写真が無ければ何も残さない', () => {
    expect(pickRecentImages([user('肉じゃがが作りたい')]).size).toBe(0);
  });

  it('上限までは全部残す', () => {
    const messages = [
      user('これ何が作れる？', [image('a'), image('b')]),
      assistant('冷蔵庫ですね'),
    ];
    expect(taggedKept(messages)).toEqual(['0:a', '0:b']);
  });

  it('上限を超えたら新しい発言の方を残す', () => {
    const messages = [
      user('1回目', [image('old1'), image('old2')]),
      assistant('はい'),
      user('2回目', [image('new1'), image('new2')]),
    ];
    expect(taggedKept(messages, 2)).toEqual(['2:new1', '2:new2']);
  });

  it('同じ発言の中でも後ろ（新しい方）を優先して残す', () => {
    const messages = [user('まとめて', [image('a'), image('b'), image('c')])];
    expect(taggedKept(messages, 2)).toEqual(['0:b', '0:c']);
  });

  it('assistant に付いた写真は載せない', () => {
    const messages: ConsultMessage[] = [
      { role: 'assistant', text: 'これはどうですか', images: [image('bogus')] },
      user('いいね'),
    ];
    expect(pickRecentImages(messages).size).toBe(0);
  });

  it('既定の上限は 4 枚', () => {
    const messages = [
      user('1', [image('a')]),
      user('2', [image('b')]),
      user('3', [image('c')]),
      user('4', [image('d')]),
      user('5', [image('e')]),
    ];
    expect(taggedKept(messages)).toHaveLength(MAX_CONSULT_IMAGES);
    // 新しい 4 件（b〜e）が残り、いちばん古い a が落ちる
    expect(taggedKept(messages)).toEqual(['1:b', '2:c', '3:d', '4:e']);
  });
});
