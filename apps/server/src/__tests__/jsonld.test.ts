import { describe, expect, it } from 'vitest';

import {
  extractJsonLdRecipe,
  extractSiteName,
  normalizeRecipeDraft,
  parseDuration,
} from '../lib/jsonld.js';

// ─── parseDuration ────────────────────────────────────────────────────────────

describe('parseDuration', () => {
  it('PT30M → 30', () => expect(parseDuration('PT30M')).toBe(30));
  it('PT1H → 60', () => expect(parseDuration('PT1H')).toBe(60));
  it('PT1H30M → 90', () => expect(parseDuration('PT1H30M')).toBe(90));
  it('PT0M → null', () => expect(parseDuration('PT0M')).toBeNull());
  it('null → null', () => expect(parseDuration(null)).toBeNull());
  it('number → null', () => expect(parseDuration(42)).toBeNull());
  it('empty string → null', () => expect(parseDuration('')).toBeNull());
});

// ─── extractJsonLdRecipe ──────────────────────────────────────────────────────

const KURASHIRU_HTML = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "唐揚げ",
  "description": "サクサク唐揚げ",
  "recipeYield": "2人分",
  "cookTime": "PT20M",
  "prepTime": "PT10M",
  "recipeIngredient": ["鶏もも肉 300g", "醤油 大さじ2", "酒 大さじ1"],
  "recipeInstructions": [
    { "@type": "HowToStep", "text": "鶏肉を一口大に切る" },
    { "@type": "HowToStep", "text": "調味料に漬け込む" },
    { "@type": "HowToStep", "text": "160℃の油で揚げる" }
  ]
}
</script>
</head><body></body></html>`;

const GRAPH_HTML = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebPage", "name": "test" },
    {
      "@type": "Recipe",
      "name": "肉じゃが",
      "recipeIngredient": ["じゃがいも 3個"],
      "recipeInstructions": [{ "@type": "HowToStep", "text": "切る" }]
    }
  ]
}
</script>
</head><body></body></html>`;

const NO_RECIPE_HTML = `<html><head>
<script type="application/ld+json">{"@type":"WebPage","name":"test"}</script>
</head><body></body></html>`;

describe('extractJsonLdRecipe', () => {
  it('通常の Recipe JSON-LD を抽出する', () => {
    const result = extractJsonLdRecipe(KURASHIRU_HTML);
    expect(result).not.toBeNull();
    expect(result?.['name']).toBe('唐揚げ');
  });

  it('@graph 形式から Recipe を抽出する', () => {
    const result = extractJsonLdRecipe(GRAPH_HTML);
    expect(result).not.toBeNull();
    expect(result?.['name']).toBe('肉じゃが');
  });

  it('Recipe がない HTML では null を返す', () => {
    expect(extractJsonLdRecipe(NO_RECIPE_HTML)).toBeNull();
  });

  it('空の HTML では null を返す', () => {
    expect(extractJsonLdRecipe('')).toBeNull();
  });

  it('JSON が壊れていても例外を投げない', () => {
    const broken = `<script type="application/ld+json">{ invalid json }</script>`;
    expect(() => extractJsonLdRecipe(broken)).not.toThrow();
    expect(extractJsonLdRecipe(broken)).toBeNull();
  });
});

// ─── extractSiteName ─────────────────────────────────────────────────────────

describe('extractSiteName', () => {
  it('og:site_name を抽出する', () => {
    const html = `<meta property="og:site_name" content="クラシル" />`;
    expect(extractSiteName(html)).toBe('クラシル');
  });

  it('og:site_name がなければ <title> を返す', () => {
    const html = `<title>デリッシュキッチン - レシピ動画</title>`;
    expect(extractSiteName(html)).toBe('デリッシュキッチン - レシピ動画');
  });

  it('何もなければ undefined を返す', () => {
    expect(extractSiteName('<html></html>')).toBeUndefined();
  });
});

// ─── normalizeRecipeDraft ─────────────────────────────────────────────────────

describe('normalizeRecipeDraft', () => {
  const rawResult = extractJsonLdRecipe(KURASHIRU_HTML);
  if (!rawResult) throw new Error('JSON-LD not found in test HTML');
  const draft = normalizeRecipeDraft(rawResult, 'https://example.com/recipe/karaage');

  it('title が取得される', () => expect(draft.title).toBe('唐揚げ'));
  it('description が取得される', () => expect(draft.description).toBe('サクサク唐揚げ'));
  it('servings が取得される', () => expect(draft.servings).toBe(2));
  it('cookTimeMin が取得される', () => expect(draft.cookTimeMin).toBe(20));
  it('prepTimeMin が取得される', () => expect(draft.prepTimeMin).toBe(10));
  it('ingredients が取得される', () => expect(draft.ingredients.length).toBe(3));
  it('steps が取得される', () => expect(draft.steps.length).toBe(3));
  it('sourceUrl が設定される', () =>
    expect(draft.sourceUrl).toBe('https://example.com/recipe/karaage'));
  it('confidence が high になる', () => expect(draft.confidence).toBe('high'));

  it('材料名が正しく分割される', () => {
    expect(draft.ingredients[0].name).toBe('鶏もも肉');
    // amount は "300g" または分割失敗でフルテキスト
    expect(draft.ingredients[0].name.length).toBeGreaterThan(0);
  });

  it('手順テキストが取得される', () => {
    expect(draft.steps[0].body).toBe('鶏肉を一口大に切る');
  });

  it('材料も手順もない場合は confidence が medium', () => {
    const empty = normalizeRecipeDraft({ name: 'テスト' }, 'https://example.com');
    expect(empty.confidence).toBe('medium');
  });
});
