/**
 * プロンプト変種の単体テスト（R0 / Issue #118）。
 * v1 は評価用の変種であり、**本番（infer ルート）の既定は v0 のまま**でなければならない。
 * 設計: `docs/レシピ推論の評価設計.md` §7 / §7-2
 */
import { describe, expect, it } from 'vitest';

import { buildResponseSchema, buildSystemPrompt } from '../lib/vision-recipe.js';

interface GeminiSchema {
  properties: Record<string, unknown>;
  required: string[];
}

describe('buildSystemPrompt', () => {
  it('v0 は現行の本番プロンプトのまま（挙動を変えない）', () => {
    const prompt = buildSystemPrompt('v0');
    expect(prompt).toContain('あなたは料理写真からレシピを再現する、日本語のプロの料理人です。');
    // v1 で足した指示が漏れ出していないこと
    expect(prompt).not.toContain('rejectReason');
    expect(prompt).not.toContain('improvementHints');
    expect(prompt).not.toContain('迷ったら false');
  });

  it('v1 は再現特化の要素をすべて含む', () => {
    const prompt = buildSystemPrompt('v1');
    // 判定を先にやらせる（ガードレール）
    expect(prompt).toContain('手順0');
    expect(prompt).toContain('迷ったら false');
    // 拒否カテゴリ
    for (const reason of [
      'not_food',
      'ingredients_only',
      'text_page',
      'too_dark',
      'blurry',
      'too_far',
    ]) {
      expect(prompt).toContain(reason);
    }
    // 思考の順序と、店名を料理の特定に使うこと
    expect(prompt).toContain('料理を特定する');
    expect(prompt).toContain('店名やメニュー名');
    // 家庭への翻訳（この機能の中心）
    expect(prompt).toContain('業務用の器具を前提にしない');
    // 見えないものは推定と明記
    expect(prompt).toContain('推定');
    // confidence の基準
    expect(prompt).toContain('high: 料理名を特定でき');
    // 改善ヒント
    for (const hint of [
      'add_dish_name',
      'add_menu_photo',
      'add_cross_section',
      'brighter',
      'closer',
    ]) {
      expect(prompt).toContain(hint);
    }
  });
});

describe('buildResponseSchema', () => {
  it('v0 のスキーマに評価用フィールドを混ぜない', () => {
    const schema = buildResponseSchema('v0') as GeminiSchema;
    expect(schema.properties).not.toHaveProperty('rejectReason');
    expect(schema.properties).not.toHaveProperty('improvementHints');
    expect(schema.required).toContain('title');
  });

  it('v1 は拒否理由とヒントを持ち、必須は isDish だけ', () => {
    const schema = buildResponseSchema('v1') as GeminiSchema;
    expect(schema.properties).toHaveProperty('rejectReason');
    expect(schema.properties).toHaveProperty('improvementHints');
    // 拒否時に title / ingredients / steps を空にできる必要があるため required は絞る
    expect(schema.required).toEqual(['isDish']);
    // 既存フィールドは維持
    expect(schema.properties).toHaveProperty('ingredients');
    expect(schema.properties).toHaveProperty('confidence');
  });
});
