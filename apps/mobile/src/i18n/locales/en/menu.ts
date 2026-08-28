/**
 * Meal plan (X days of menus, #215). Design: `docs/買い物リスト・在庫設計.md` §10.
 */
const menu = {
  title: 'Meal plan',
  card: {
    nextTitle: 'Up next',
    open: 'Open meal plan',
    cook: 'Cook',
    empty: 'Plan a few days of meals from what you have',
    build: 'Plan meals',
  },
  days: {
    label: 'How many days',
    option: '{{count}} days',
  },
  day: {
    label: 'Day {{day}}',
    openRecipe: 'Open recipe',
    replace: 'Swap',
    done: 'Cooked',
    missing: 'This recipe is gone',
    noTime: 'No time recorded',
    minutes: '{{count}} min',
  },
  reason: {
    expiry: '{{name}} is expiring soon',
    coverage: 'You already have {{count}} of the ingredients',
    pinned: "It's on your want-to-cook list",
    fewMissing: 'Only {{count}} things to buy',
  },
  claim: {
    contested: 'Used on {{count}} days',
  },
  emptyDays: {
    title: "Couldn't plan any meals",
    noRecipes: 'No recipes yet. Add a few first.',
    fewRecipes: 'Not enough recipes, so only some days are filled',
    toConsult: 'Create one with AI',
  },
  stale: {
    message: 'Your pantry changed',
    rebuild: 'Plan again',
  },
  shopping: {
    add: 'Add all missing ingredients',
    none: 'Nothing missing',
  },
  warnEmptyPantry: 'Your pantry is empty, so this plan assumes shopping',
  ai: {
    button: 'Let AI rearrange it',
    running: 'Rearranging…',
    failed: "We couldn't rearrange it with AI. Keeping the current plan.",
    emptyResult: "We couldn't use the AI suggestion. Keeping the current plan.",
    arrangedBadge: 'Arranged by AI',
    limitNote: {
      one: 'Free, {{count}} time a month',
      other: 'Free, {{count}} times a month',
    },
  },
};

export default menu;
