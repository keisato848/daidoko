/**
 * JSON-LD Recipe schema parser
 * Extracts @type:"Recipe" from HTML and normalizes to RecipeDraft
 */

export interface RecipeDraft {
  title: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  prepTimeMin?: number;
  ingredients: IngredientDraft[];
  steps: StepDraft[];
  sourceUrl?: string;
  sourceName?: string;
  confidence: 'high' | 'medium' | 'low';
}

interface IngredientDraft {
  name: string;
  amount?: string;
}

interface StepDraft {
  body: string;
}

// ─── JSON-LD extraction ─────────────────────────────────────────────────────

const JSON_LD_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export function extractJsonLdRecipe(html: string): Record<string, unknown> | null {
  let match: RegExpExecArray | null;
  JSON_LD_RE.lastIndex = 0;

  while ((match = JSON_LD_RE.exec(html)) !== null) {
    try {
      const raw: unknown = JSON.parse(match[1].trim());
      const candidates = Array.isArray(raw)
        ? (raw as unknown[])
        : (raw as Record<string, unknown>)['@graph']
          ? ((raw as Record<string, unknown>)['@graph'] as unknown[])
          : [raw];

      for (const item of candidates) {
        const obj = item as Record<string, unknown>;
        const type = obj['@type'];
        if (type === 'Recipe' || (Array.isArray(type) && (type as string[]).includes('Recipe'))) {
          return obj;
        }
      }
    } catch {
      // malformed JSON — continue to next script tag
    }
  }
  return null;
}

// ─── ISO 8601 duration parser ────────────────────────────────────────────────

/** "PT1H30M" → 90, "PT30M" → 30, "P0D" → null */
export function parseDuration(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const m = iso.match(/(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return null;
  const hours = parseInt(m[1] ?? '0', 10);
  const mins = parseInt(m[2] ?? '0', 10);
  const total = hours * 60 + mins;
  return total > 0 ? total : null;
}

// ─── Servings parser ─────────────────────────────────────────────────────────

/** "4人分" | "4" | ["4"] → 4 */
function parseServings(raw: unknown): number | null {
  if (raw == null) return null;
  const str = Array.isArray(raw) ? String(raw[0]) : String(raw);
  const m = str.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// ─── Ingredient parser ────────────────────────────────────────────────────────

/**
 * Splits Japanese ingredient string like "じゃがいも 3個" or "牛肉 200g"
 * into { name, amount }.
 * Amount (if any) appears AFTER the ingredient name in Japanese recipe sites.
 */
function parseIngredient(raw: string): IngredientDraft {
  const text = raw.trim();
  // Pattern: name followed by amount (number+unit or fraction)
  const m = text.match(
    /^(.+?)\s+([\d/½¼¾\.]+\s*[a-zA-Zg㎖mlリットル個本枚枚本切れ適量少々大さじ小さじカップ合束袋缶本個枚玉片串匹尾頭羽本足杯杯丁冊膳箱瓶缶個本]+)$/u,
  );
  if (m) {
    return { name: m[1].trim(), amount: m[2].trim() };
  }
  return { name: text };
}

// ─── Step parser ─────────────────────────────────────────────────────────────

function parseStep(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    // HowToStep
    if (typeof obj['text'] === 'string') return obj['text'].trim();
    if (typeof obj['name'] === 'string') return obj['name'].trim();
    // HowToSection containing itemListElement
    if (Array.isArray(obj['itemListElement'])) {
      return (obj['itemListElement'] as unknown[])
        .map((s) => parseStep(s))
        .filter(Boolean)
        .join(' ');
    }
  }
  return null;
}

// ─── Site name extraction ─────────────────────────────────────────────────────

const SITE_RE = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i;
const TITLE_RE = /<title[^>]*>([^<]+)<\/title>/i;

export function extractSiteName(html: string): string | undefined {
  const m = SITE_RE.exec(html) ?? TITLE_RE.exec(html);
  return m ? m[1].trim() : undefined;
}

// ─── Main normalizer ──────────────────────────────────────────────────────────

export function normalizeRecipeDraft(
  raw: Record<string, unknown>,
  sourceUrl: string,
  siteName?: string,
): RecipeDraft {
  const title =
    typeof raw['name'] === 'string'
      ? raw['name'].trim()
      : typeof raw['headline'] === 'string'
        ? raw['headline'].trim()
        : 'レシピ';

  const description =
    typeof raw['description'] === 'string' ? raw['description'].trim() : undefined;

  const cookTimeMin =
    parseDuration(raw['cookTime']) ?? parseDuration(raw['totalTime']) ?? undefined;

  const prepTimeMin = parseDuration(raw['prepTime']) ?? undefined;

  const servings = parseServings(raw['recipeYield']) ?? undefined;

  const rawIngredients = Array.isArray(raw['recipeIngredient'])
    ? (raw['recipeIngredient'] as unknown[])
    : [];
  const ingredients: IngredientDraft[] = rawIngredients
    .map((i) => (typeof i === 'string' ? parseIngredient(i) : null))
    .filter((i): i is IngredientDraft => i !== null && i.name.length > 0);

  const rawInstructions = Array.isArray(raw['recipeInstructions'])
    ? (raw['recipeInstructions'] as unknown[])
    : [];
  const steps: StepDraft[] = rawInstructions
    .map((s) => parseStep(s))
    .filter((s): s is string => s !== null && s.length > 0)
    .map((body) => ({ body }));

  return {
    title,
    ...(description !== undefined && { description }),
    ...(servings !== undefined && { servings }),
    ...(cookTimeMin !== undefined && { cookTimeMin }),
    ...(prepTimeMin !== undefined && { prepTimeMin }),
    ingredients,
    steps,
    sourceUrl,
    ...(siteName !== undefined && { sourceName: siteName }),
    confidence:
      ingredients.length > 0 && steps.length > 0 ? ('high' as const) : ('medium' as const),
  };
}
