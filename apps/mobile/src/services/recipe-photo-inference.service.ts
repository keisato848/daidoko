import type { RecipeFormData } from '../validation/recipe.schema';
import type { ClientImageLabel } from './client-image-label.provider';

export type PhotoRecipeConfidence = 'high' | 'medium' | 'low';

interface RecipePhotoProfile {
  id: string;
  keywords: string[];
  title: string;
  description: string;
  tags: string[];
  ingredients: string[];
  steps: string[];
}

export interface RecipePhotoInferenceResult {
  draft: RecipeFormData;
  confidence: PhotoRecipeConfidence;
  labels: ClientImageLabel[];
  labelSummary: string;
  warnings: string[];
}

const GENERIC_INGREDIENTS = [
  '主食材（写真を見て確認）',
  '野菜（写真を見て確認）',
  '調味料',
  '油またはバター',
];

const GENERIC_STEPS = [
  '写真から分かる食材を確認し、食べやすい大きさに整える。',
  '主食材に火が通るまで加熱し、調味料で味を整える。',
  '味見をして分量を調整し、器に盛る。',
];

const FOODISH_KEYWORDS = [
  'food',
  'dish',
  'cuisine',
  'meal',
  'ingredient',
  'produce',
  'vegetable',
  'fruit',
  'meat',
  'seafood',
  'tableware',
  'plate',
  'bowl',
  '料理',
  '食品',
  '食べ物',
  '野菜',
];

const PROFILES: RecipePhotoProfile[] = [
  {
    id: 'curry',
    keywords: ['curry', 'stew', 'gravy', 'sauce'],
    title: '写真からつくったカレー',
    description: '写真の色味と盛り付けからつくったカレー風の下書きです。',
    tags: ['写真から','カレー'],
    ingredients: ['肉または豆', '玉ねぎ', 'にんじん', 'じゃがいも', 'カレー粉またはルー', '水'],
    steps: [
      '具材を食べやすく切る。',
      '鍋で具材を炒め、水を加えて煮る。',
      'ルーまたはスパイスを加え、とろみが出るまで煮る。',
    ],
  },
  {
    id: 'pasta',
    keywords: ['pasta', 'spaghetti', 'noodle', 'italian'],
    title: '写真からつくったパスタ',
    description: '麺料理としてつくった下書きです。ソースや具材は写真を見て調整してください。',
    tags: ['写真から','麺'],
    ingredients: ['パスタまたは麺', 'ソース', '具材', '塩', 'オリーブオイル'],
    steps: ['麺を表示時間どおりに茹でる。', '具材とソースを温める。', '麺を合わせ、味を整える。'],
  },
  {
    id: 'salad',
    keywords: ['salad', 'vegetable', 'lettuce', 'produce'],
    title: '写真からつくったサラダ',
    description: '野菜中心の料理としてつくった下書きです。',
    tags: ['写真から','野菜'],
    ingredients: ['葉物野菜', 'トマトまたは彩り野菜', 'たんぱく質の具材', 'ドレッシング'],
    steps: [
      '野菜を洗って水気を切る。',
      '具材を食べやすく切る。',
      'ドレッシングで和えて盛り付ける。',
    ],
  },
  {
    id: 'soup',
    keywords: ['soup', 'broth', 'ramen', 'bowl'],
    title: '写真からつくったスープ',
    description: '汁物としてつくった下書きです。',
    tags: ['写真から','汁物'],
    ingredients: ['だしまたはスープ', '野菜', '肉または魚介', '塩', 'こしょう'],
    steps: ['具材を切る。', '鍋でスープを温め、具材を煮る。', '味を整えて器に盛る。'],
  },
  {
    id: 'rice',
    keywords: ['rice', 'fried rice', 'risotto', 'grain'],
    title: '写真からつくったごはん料理',
    description: 'ごはんを使った料理としてつくった下書きです。',
    tags: ['写真から','ごはん'],
    ingredients: ['ごはん', '具材', '卵またはたんぱく質', '調味料'],
    steps: ['具材を切る。', 'フライパンで具材を炒める。', 'ごはんを加えて炒め、味を整える。'],
  },
  {
    id: 'baked',
    keywords: ['pizza', 'bread', 'baked', 'pastry', 'cake', 'dessert'],
    title: '写真からつくった焼き料理',
    description: '焼いた料理または菓子としてつくった下書きです。',
    tags: ['写真から','焼き料理'],
    ingredients: ['生地または主食材', '具材', '油脂', '塩または砂糖'],
    steps: [
      '材料を混ぜ、形を整える。',
      'オーブンまたはフライパンで焼く。',
      '焼き色を確認して取り出す。',
    ],
  },
];

function normalizeLabelText(text: string): string {
  return text.trim().toLowerCase();
}

function summarizeLabels(labels: ClientImageLabel[]): string {
  return labels
    .slice(0, 6)
    .map((label) => `${label.text} ${Math.round(label.confidence * 100)}%`)
    .join(' / ');
}

function includesKeyword(labelText: string, keyword: string): boolean {
  return labelText.includes(keyword.toLowerCase());
}

function scoreProfile(labels: ClientImageLabel[], profile: RecipePhotoProfile): number {
  return labels.reduce((score, label) => {
    const labelText = normalizeLabelText(label.text);
    const matched = profile.keywords.some((keyword) => includesKeyword(labelText, keyword));
    return matched ? Math.max(score, label.confidence) : score;
  }, 0);
}

function chooseProfile(labels: ClientImageLabel[]): {
  profile: RecipePhotoProfile | null;
  score: number;
} {
  return PROFILES.reduce(
    (best, profile) => {
      const score = scoreProfile(labels, profile);
      return score > best.score ? { profile, score } : best;
    },
    { profile: null as RecipePhotoProfile | null, score: 0 },
  );
}

function hasFoodishLabel(labels: ClientImageLabel[]): boolean {
  return labels.some((label) => {
    const labelText = normalizeLabelText(label.text);
    return FOODISH_KEYWORDS.some((keyword) => includesKeyword(labelText, keyword));
  });
}

function ingredient(name: string): RecipeFormData['ingredients'][number] {
  return { name, amount: '', groupLabel: '', note: '' };
}

function step(body: string): RecipeFormData['steps'][number] {
  return { body, timerSec: undefined };
}

export function inferRecipeFromPhotoLabels(labels: ClientImageLabel[]): RecipePhotoInferenceResult {
  const sortedLabels = [...labels].sort((left, right) => right.confidence - left.confidence);
  const { profile, score } = chooseProfile(sortedLabels);
  const foodish = hasFoodishLabel(sortedLabels);
  const confidence: PhotoRecipeConfidence = score >= 0.72 ? 'medium' : foodish ? 'low' : 'low';
  const selected = profile ?? {
    id: 'generic',
    keywords: [],
    title: '料理写真からのレシピ案',
    description: '写真からつくった下書きです。料理名・分量・手順を確認してください。',
    tags: ['写真から'],
    ingredients: GENERIC_INGREDIENTS,
    steps: GENERIC_STEPS,
  };
  const labelSummary = summarizeLabels(sortedLabels);
  const warnings = ['写真だけでは分量・加熱時間・隠れた調味料を確定できません'];

  if (!profile) warnings.push('料理名を特定できなかったため、汎用の下書きにしました');
  if (labelSummary) warnings.push(`画像ラベル: ${labelSummary}`);

  return {
    draft: {
      title: selected.title,
      titleReading: '',
      description: selected.description,
      servings: 2,
      cookTimeMin: 20,
      prepTimeMin: 10,
      ingredients: selected.ingredients.map(ingredient),
      steps: selected.steps.map(step),
      tags: selected.tags,
    },
    confidence,
    labels: sortedLabels,
    labelSummary,
    warnings,
  };
}
