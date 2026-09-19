/**
 * 枠の種類（slotKind・Track C PR-5b）でプロンプトを出し分ける。
 *
 * いちばん守りたいのは **「主菜（省略時）は 1 文字も変わっていない」**こと。旧アプリは slotKind を
 * 送らないので、ここが動くと公開中の全利用者の生成結果が黙って変わる。同じ関数どうしを比べても
 * 何も守れないので、**変更前（origin/main・2026-09-19）の出力の SHA-256** と突き合わせる。
 * 主菜のプロンプトを意図して変えるときは、このハッシュを更新すること（＝変えたと自覚する場所）。
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { menuRecipesRequestSchema } from '../infer-guards.js';
import {
  MENU_SLOT_KINDS,
  buildMenuRecipesContext,
  buildMenuRecipesSystemPrompt,
} from '../menu-recipes.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const MAIN_PROMPT_SHA = {
  breakfast: '0cf305e29c06da5c84b4d3d5eb266d13bc4ffd97c6baef5a80d7f28602d75ffa',
  lunch: 'e125a3b0dfa523a93a7540e0d9a09c696fa462eee39e80af35b49422ed16db39',
  dinner: '8f21ff594187996999861c489a679208cbf0d9004dd6aaff251fe35cd1107f3d',
} as const;

const INPUT = {
  days: 2,
  existingTitles: ['肉じゃが'],
  pantry: ['豆腐'],
  preferences: '辛いものは控えめ',
};
const MAIN_CONTEXT_SHA = '4529d1a25f6489daf8d2fd098b985e9647e24204ac97d828483ded955a6f35b4';

describe('主菜（slotKind 省略）は従来と 1 文字も変わらない', () => {
  it.each(['breakfast', 'lunch', 'dinner'] as const)('%s のプロンプト', (mealTime) => {
    expect(sha(buildMenuRecipesSystemPrompt(mealTime))).toBe(MAIN_PROMPT_SHA[mealTime]);
    expect(sha(buildMenuRecipesSystemPrompt(mealTime, 'main'))).toBe(MAIN_PROMPT_SHA[mealTime]);
  });

  it('文脈も同じ。主菜のときは mainTitles が来ても書かない', () => {
    expect(sha(buildMenuRecipesContext(INPUT))).toBe(MAIN_CONTEXT_SHA);
    expect(
      sha(buildMenuRecipesContext({ ...INPUT, slotKind: 'main', mainTitles: ['唐揚げ'] })),
    ).toBe(MAIN_CONTEXT_SHA);
  });
});

describe('主菜以外', () => {
  it.each([
    ['side', '副菜'],
    ['soup', '汁物'],
    ['salad', 'サラダ'],
    ['dessert', 'デザート'],
  ] as const)('%s は「主菜に添える%s」を頼む', (slotKind, label) => {
    const prompt = buildMenuRecipesSystemPrompt('dinner', slotKind);
    expect(prompt).toContain(`献立の主菜に添える${label}を、指定の品数だけまとめて作ります。`);
    // 主菜向けの 1 行は消えている（残ると「足りない品数ぶんのレシピ」＝主菜級が返る）
    expect(prompt).not.toContain('利用者の献立に足りない品数ぶんのレシピ');
    // 安全側の規則は種類を問わず残る
    expect(prompt).toContain('**アレルゲンの有無を保証する。**');
    expect(prompt).toContain('指定より多い・少ない品数を返す。');
  });

  it('副菜・汁物は軽さ（15 分・材料 5 つ前後）を縛る。サラダ・デザートは縛らない', () => {
    for (const kind of ['side', 'soup'] as const) {
      expect(buildMenuRecipesSystemPrompt('dinner', kind)).toContain('調理は 15 分以内');
    }
    for (const kind of ['salad', 'dessert'] as const) {
      expect(buildMenuRecipesSystemPrompt('dinner', kind)).not.toContain('調理は 15 分以内');
    }
  });

  it('時間帯の出し分けは主菜以外でも効く', () => {
    expect(buildMenuRecipesSystemPrompt('lunch', 'soup')).toContain('昼食');
  });

  it('合わせる主菜を文脈へ書く（最大 7 品）', () => {
    const titles = ['1', '2', '3', '4', '5', '6', '7', '8'].map((n) => `主菜${n}`);
    const context = buildMenuRecipesContext({ ...INPUT, slotKind: 'soup', mainTitles: titles });
    expect(context).toContain('## 合わせる主菜');
    expect(context).toContain('主菜7');
    expect(context).not.toContain('主菜8');
  });

  it('mainTitles が空なら見出しごと書かない', () => {
    const context = buildMenuRecipesContext({ ...INPUT, slotKind: 'soup', mainTitles: [] });
    expect(context).not.toContain('合わせる主菜');
  });
});

describe('要求の検証（同期ルートとジョブで共用）', () => {
  const base = { days: 1, existingTitles: [], pantry: [] };

  it('slotKind は省略可。既知の 5 種類だけ通す', () => {
    expect(menuRecipesRequestSchema.safeParse(base).success).toBe(true);
    for (const slotKind of MENU_SLOT_KINDS) {
      expect(menuRecipesRequestSchema.safeParse({ ...base, slotKind }).success).toBe(true);
    }
    expect(menuRecipesRequestSchema.safeParse({ ...base, slotKind: 'appetizer' }).success).toBe(
      false,
    );
  });

  it('mainTitles は 7 品まで・1 品 100 字まで', () => {
    const ok = Array.from({ length: 7 }, (_, i) => `主菜${i}`);
    expect(menuRecipesRequestSchema.safeParse({ ...base, mainTitles: ok }).success).toBe(true);
    expect(menuRecipesRequestSchema.safeParse({ ...base, mainTitles: [...ok, '8'] }).success).toBe(
      false,
    );
    expect(
      menuRecipesRequestSchema.safeParse({ ...base, mainTitles: ['あ'.repeat(101)] }).success,
    ).toBe(false);
  });
});
