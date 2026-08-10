/**
 * Formats a recipe as plain shareable text (S05 共有).
 *
 * The layout intentionally matches what utils/recipeTextParser.parseRecipeText
 * understands (the same shape as RECIPE_TEXT_AI_PROMPT's output format), so
 * text shared from だいどこ can be pasted straight into 「テキストから取り込み」
 * on another device — recipe exchange with no server involved.
 */
import type { RecipeDetail } from '../services/types';
import { t, tCount } from '../i18n';

export function formatRecipeShareText(recipe: RecipeDetail): string {
  const lines: string[] = [recipe.title];

  if (recipe.servings != null) lines.push(tCount('ui.share.servings', recipe.servings));
  if (recipe.cookTimeMin != null) {
    lines.push(tCount('ui.share.cookTime', recipe.cookTimeMin));
  }

  if (recipe.ingredients.length > 0) {
    lines.push('', t('ui.share.ingredients'));
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
    lines.push('', t('ui.share.steps'));
    recipe.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.body}`);
    });
  }

  if (recipe.description && recipe.description.trim()) {
    lines.push('', t('ui.share.memo'), recipe.description.trim());
  }

  return lines.join('\n');
}
