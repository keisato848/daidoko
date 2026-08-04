/**
 * レシピの差分。**AI が黙って書き換えないための仕組み**（Issue #113）。
 *
 * 調整前後を突き合わせて、何が変わったかを行単位で出す。ユーザーはこれを見てから
 * 確定するので、「関係ない材料まで書き換わっていないか」を自分の目で確認できる。
 */
import type { RecipeFormData } from '../validation/recipe.schema';

export type DiffKind = 'added' | 'removed' | 'changed' | 'unchanged';

export interface DiffRow {
  kind: DiffKind;
  /** 材料名・手順番号など、行の見出し */
  label: string;
  /** 変更前（added のときは undefined） */
  before?: string;
  /** 変更後（removed のときは undefined） */
  after?: string;
}

export interface RecipeDiff {
  ingredients: DiffRow[];
  steps: DiffRow[];
  /** タイトル・人数・時間などの変更（無ければ空） */
  meta: DiffRow[];
  /** 何か1つでも変わったか */
  hasChanges: boolean;
  /** 変わった行の数（unchanged を除く） */
  changeCount: number;
}

function ingredientValue(ing: { amount?: string; note?: string }): string {
  const amount = ing.amount?.trim() ?? '';
  const note = ing.note?.trim() ?? '';
  if (amount && note) return `${amount}（${note}）`;
  return amount || note || '—';
}

/** 同じ材料として扱うキー。グループが変わっても名前が同じなら追跡する。 */
function ingredientKey(ing: { name: string }): string {
  return ing.name.trim();
}

function metaRow(label: string, before: unknown, after: unknown): DiffRow | null {
  const b = before === undefined || before === null || before === '' ? undefined : String(before);
  const a = after === undefined || after === null || after === '' ? undefined : String(after);
  if (b === a) return null;
  return {
    kind: b === undefined ? 'added' : a === undefined ? 'removed' : 'changed',
    label,
    ...(b !== undefined && { before: b }),
    ...(a !== undefined && { after: a }),
  };
}

/**
 * 材料は名前で対応づける（並び替えに強い）。手順は位置で対応づける
 * （同じ文面が複数あり得るうえ、順序そのものが意味を持つため）。
 */
export function diffRecipes(before: RecipeFormData, after: RecipeFormData): RecipeDiff {
  const meta = [
    metaRow('料理名', before.title, after.title),
    metaRow('人数', before.servings, after.servings),
    metaRow('調理時間', before.cookTimeMin, after.cookTimeMin),
  ].filter((row): row is DiffRow => row !== null);

  const ingredients: DiffRow[] = [];
  const afterByKey = new Map(after.ingredients.map((ing) => [ingredientKey(ing), ing]));
  const seen = new Set<string>();

  for (const beforeIng of before.ingredients) {
    const key = ingredientKey(beforeIng);
    seen.add(key);
    const afterIng = afterByKey.get(key);
    if (!afterIng) {
      ingredients.push({
        kind: 'removed',
        label: beforeIng.name,
        before: ingredientValue(beforeIng),
      });
      continue;
    }
    const beforeValue = ingredientValue(beforeIng);
    const afterValue = ingredientValue(afterIng);
    ingredients.push({
      kind: beforeValue === afterValue ? 'unchanged' : 'changed',
      label: beforeIng.name,
      before: beforeValue,
      after: afterValue,
    });
  }
  for (const afterIng of after.ingredients) {
    if (seen.has(ingredientKey(afterIng))) continue;
    ingredients.push({ kind: 'added', label: afterIng.name, after: ingredientValue(afterIng) });
  }

  const steps: DiffRow[] = [];
  const stepCount = Math.max(before.steps.length, after.steps.length);
  for (let index = 0; index < stepCount; index++) {
    const beforeBody = before.steps[index]?.body;
    const afterBody = after.steps[index]?.body;
    const label = `手順 ${index + 1}`;
    if (beforeBody === undefined) {
      steps.push({ kind: 'added', label, after: afterBody ?? '' });
    } else if (afterBody === undefined) {
      steps.push({ kind: 'removed', label, before: beforeBody });
    } else {
      steps.push({
        kind: beforeBody === afterBody ? 'unchanged' : 'changed',
        label,
        before: beforeBody,
        after: afterBody,
      });
    }
  }

  const changeCount = [...meta, ...ingredients, ...steps].filter(
    (row) => row.kind !== 'unchanged',
  ).length;

  return { ingredients, steps, meta, hasChanges: changeCount > 0, changeCount };
}

/** 変わった行だけを残す（既定の表示。全文は「すべて表示」で出す）。 */
export function onlyChanged(rows: DiffRow[]): DiffRow[] {
  return rows.filter((row) => row.kind !== 'unchanged');
}
