import type ja from '../ja/recipe';

const recipe: typeof ja = {
  detail: {
    loading: 'Loading recipe',
    notFoundTitle: 'Recipe not found',
    notFoundMessage: 'It was deleted, or it can’t be opened.',
    backToList: 'Back to recipes',

    tab: {
      ingredients: 'Ingredients',
      steps: 'Steps',
      memo: 'Notes',
      history: 'History',
    },

    servingsValue: {
      one: 'serves {{count}}',
      other: 'serves {{count}}',
    },
    cookTimeValue: {
      one: '{{count}} min',
      other: '{{count}} min',
    },
    servingsSuffix: 'servings',

    stepTimerMinutes: {
      one: '{{count}} min',
      other: '{{count}} min',
    },
    stepTimerSeconds: {
      one: '{{count}} sec',
      other: '{{count}} sec',
    },

    menuLabel: 'Menu (edit, get closer to the restaurant taste, version history)',
    menu: {
      refine: 'Get closer to the restaurant taste',
      edit: 'Edit',
      share: 'Share',
      revisions: 'Version history',
    },

    pinAdd: 'Add to “Want to recreate”',
    pinRemove: 'Remove from “Want to recreate”',

    deleteTitle: 'Delete recipe',
    deleteConfirm: {
      text: 'Delete this recipe?',
      intent:
        'MUST make clear the recipe will be deleted. This is a destructive, irreversible action ' +
        'confirmed only by this dialog.',
    },
    deleteFailedTitle: 'Deleting failed',
    deleteFailedBody: 'Please try again in a moment.',

    shoppingTitle: 'Shopping list',
    shoppingAdded: {
      one: 'Added {{count}} missing item to your shopping list',
      other: 'Added {{count}} missing items to your shopping list',
    },
    shoppingNothingMissing: 'You already have everything',
    addMissingLabel: 'Add missing ingredients to the shopping list',

    emptyMemo: 'No notes yet',
    emptyHistory: 'No cooking records yet',
    emptyHistoryHint: 'After cooking, tap “Record” to save a rating and notes',

    startCooking: 'Start cooking',
    logShortcut: 'Record what you cooked',

    coach: {
      cookTitle: 'Start cooking',
      cookText:
        'Shows one step at a time, full screen — with timers and the screen kept awake so you can focus on cooking.',
      logTitle: 'Record it, then get closer to the taste',
      logText:
        'Save a rating, notes and photos here. Once you’ve written how it turned out, use “Get closer to the restaurant taste” in the top-right menu to adjust the recipe.',
    },
  },

  list: {
    loading: 'Loading recipes',
    search: 'Search recipes',
    sort: 'Sort',
    sortBy: {
      recent: 'Newest first',
      cookCount: 'Most cooked',
      rating: 'Highest rated',
      cookTime: 'Quickest first',
      name: 'By name',
    },
    filterAll: 'All',
    countSuffix: {
      one: '{{count}} recipe',
      other: '{{count}} recipes',
    },
    ingredientHitNote: ' (matched by ingredient)',

    selectCount: {
      one: '{{count}} selected',
      other: '{{count}} selected',
    },
    selectAll: 'Select all',

    deleteTitle: 'Delete recipes',
    deleteConfirm: {
      one: {
        text: 'Delete {{count}} recipe? This cannot be undone.',
        intent:
          'MUST state that the deletion CANNOT be undone and MUST state how many recipes are ' +
          'affected. MUST NOT soften "cannot be undone".',
      },
      other: {
        text: 'Delete {{count}} recipes? This cannot be undone.',
        intent:
          'MUST state that the deletion CANNOT be undone and MUST state how many recipes are ' +
          'affected. MUST NOT soften "cannot be undone".',
      },
    },

    emptyTitle: 'No recipes yet',
    emptyMessage:
      'Add recipes from a URL, a photo, or by typing them in, and they’ll line up here as your collection.',
    emptyAction: 'Add a recipe',
    noMatchTitle: 'No recipes match',
    noMatchMessage: 'Try different keywords or filters.',
    addLabel: 'Add a recipe',

    coach: {
      searchTitle: 'Finding recipes',
      searchText: 'Search by recipe name, tag, or ingredient (for example “egg”).',
      addTitle: 'Adding more recipes',
      addText:
        'Use the “Add” tab below to enter a recipe by hand, import one from a URL, or create one from a photo with AI.',
    },
  },

  refine: {
    diffGuarantee: {
      text: 'Anything not listed here is unchanged. Please review before saving.',
      intent:
        'MUST convey an absolute guarantee: anything NOT shown in the diff is unchanged. ' +
        'MUST NOT be softened to a probability ("may not have changed", "should be unchanged") — ' +
        'this sentence is the reason the diff preview exists as a safety check.',
    },
    noChange: {
      text: 'We couldn\'t tell what to change from your notes. Try describing the taste — for example "too sweet" or "needs more heat".',
      intent:
        'MUST tell the user WHAT TO WRITE next (a taste direction), with examples. ' +
        'MUST NOT be a bare "try again" — retrying the same text cannot succeed. ' +
        'This is an input-insufficiency message, not an error.',
    },

    failed: "We couldn't adjust the recipe",
    convertFailed: "We couldn't apply the adjustment to the recipe",
    done: 'Recipe adjusted.',
  },
};

export default recipe;
