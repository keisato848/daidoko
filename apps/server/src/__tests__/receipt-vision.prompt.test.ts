/**
 * レシート抽出のプロンプトと構造化出力スキーマ（Issue #178-1）。
 *
 * 数量は**在庫に合算される**ので、読めなかったものを 1 で埋める指示に後退すると
 * 「家に無いものが在庫にある」状態が静かに積もる。スキーマ側で quantity / unit を
 * required にしてしまうと、モデルは埋めるしかなくなる — ここを固定する。
 */
import { describe, expect, it } from 'vitest';

import {
  RECEIPT_RESPONSE_SCHEMA,
  RECEIPT_SYSTEM_PROMPT,
  RECEIPT_TEXT_SYSTEM_PROMPT,
} from '../lib/receipt-vision.js';

interface GeminiObjectSchema {
  properties: Record<string, unknown>;
  required?: readonly string[];
}

describe('RECEIPT_SYSTEM_PROMPT', () => {
  it('数量と単位を読ませる', () => {
    expect(RECEIPT_SYSTEM_PROMPT).toContain('quantity');
    expect(RECEIPT_SYSTEM_PROMPT).toContain('unit');
  });

  it('読めない数量を推測させない', () => {
    expect(RECEIPT_SYSTEM_PROMPT).toContain('1 で埋めない');
    expect(RECEIPT_SYSTEM_PROMPT).toContain('値引き');
  });

  it('品目名の正規化と非商品行の除外は従来どおり残っている', () => {
    expect(RECEIPT_SYSTEM_PROMPT).toContain('半角カナ');
    expect(RECEIPT_SYSTEM_PROMPT).toContain('小計・合計');
  });
});

describe('RECEIPT_TEXT_SYSTEM_PROMPT', () => {
  /**
   * テキスト経路は端末内 OCR の生テキストを渡す（`docs/在庫・レシート設計レビュー.md` §3.4）。
   * 品目の作り方が画像経路とずれると、**同じレシートが経路によって違う在庫になる**。
   */
  it('品目の作り方は画像経路と同じ規則を持つ', () => {
    for (const rule of ['半角カナ', '小計・合計', '1 で埋めない', '値引き']) {
      expect(RECEIPT_TEXT_SYSTEM_PROMPT).toContain(rule);
    }
  });

  it('画像を見る前提の文言が残っていない', () => {
    expect(RECEIPT_TEXT_SYSTEM_PROMPT).not.toContain('写真');
  });

  it('OCR の崩れ（列のずれ・誤認識）を前提にしている', () => {
    expect(RECEIPT_TEXT_SYSTEM_PROMPT).toContain('OCR');
    expect(RECEIPT_TEXT_SYSTEM_PROMPT).toContain('誤認識');
  });

  it('レシートでないテキストを isReceipt=false で返させる', () => {
    expect(RECEIPT_TEXT_SYSTEM_PROMPT).toContain('isReceipt=false');
  });
});

describe('RECEIPT_RESPONSE_SCHEMA', () => {
  const itemSchema = (RECEIPT_RESPONSE_SCHEMA.properties.items as { items: GeminiObjectSchema })
    .items;

  it('品目は name / quantity / unit を持つ', () => {
    expect(Object.keys(itemSchema.properties).sort()).toEqual(['name', 'quantity', 'unit']);
    expect(itemSchema.properties['quantity']).toEqual({ type: 'NUMBER' });
  });

  it('quantity / unit は必須にしない（読めなかったことを表せる必要がある）', () => {
    expect(itemSchema.required).toEqual(['name']);
  });
});
