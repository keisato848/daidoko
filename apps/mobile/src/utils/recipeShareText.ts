/**
 * Formats a recipe as plain shareable text (S05 共有).
 *
 * The layout intentionally matches what utils/recipeTextParser.parseRecipeText
 * understands (the same shape as RECIPE_TEXT_AI_PROMPT's output format), so
 * text shared from だいどこ can be pasted straight into 「テキストから取り込み」
 * on another device — recipe exchange with no server involved.
 */
import type { RecipeDetail } from '../services/types';

export function formatRecipeShareText(recipe: RecipeDetail): string {
  const lines: string[] = [recipe.title];

  if (recipe.servings != null) lines.push(`${recipe.servings}人分`);
  if (recipe.cookTimeMin != null) lines.push(`調理時間 ${recipe.cookTimeMin}分`);

  if (recipe.ingredients.length > 0) {
    lines.push('', '材料');
    for (const ing of recipe.ingredients) {
      // groupLabel はパーサ非対応なので名前に添える（取り込み時は名前の一部になる）
      const name = ing.groupLabel ? `【${ing.groupLabel}】${ing.name}` : ing.name;
      const amount = [ing.amount, ing.note ? `（${ing.note}）` : '']
        .filter(Boolean)
        .join('')
        .trim();
      lines.push(amount ? `${name} ${amount}` : name);
    }
  }

  if (recipe.steps.length > 0) {
    lines.push('', '作り方');
    recipe.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.body}`);
    });
  }

  if (recipe.description && recipe.description.trim()) {
    lines.push('', 'メモ', recipe.description.trim());
  }

  return lines.join('\n');
}
