import type ja from '../ja/recipe';

const recipe: typeof ja = {
  validation: {
    ingredientNameRequired: 'An ingredient name is required',
    ingredientNameTooLong: 'Use 50 characters or fewer',
    stepRequired: 'A step is required',
    stepTooLong: 'Use 500 characters or fewer',
    titleRequired: 'A recipe name is required',
    titleTooLong: 'Use 100 characters or fewer',
    ingredientsRequired: 'Add at least one ingredient',
    stepsRequired: 'Add at least one step',
  },

  form: {
    titleLabel: 'Recipe name',
    titlePlaceholder: 'e.g. Beef stew',
    readingLabel: 'Reading',
    readingPlaceholder: 'e.g. beef stew',
    descriptionLabel: 'Description',
    placeLabel: 'Restaurant name',
    placePlaceholder: 'e.g. Joe’s Diner (optional)',
    descriptionPlaceholder: 'A short description (optional)',
    minutesSuffix: 'min',
    photoSection: 'Photo',
    createTitle: 'New recipe',
    editTitle: 'Edit recipe',
    update: 'Update',
    saved: 'Recipe saved',
    updated: 'Recipe updated',
    addIngredient: '＋ Add ingredient',
    addStep: '＋ Add step',
  },

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
    servingsUnit: {
      one: 'serving',
      other: 'servings',
    },

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
      webShare: 'Share as web page',
      webShareSend: 'Send web share link',
      webShareStop: 'Stop web sharing',
      revisions: 'Version history',
    },

    webShare: {
      attestTitle: 'Is this your own recipe?',
      attestBody:
        'Web sharing is only for content you created yourself. Recipes copied from other sites or books cannot be shared.\n\nAnyone with the link can view this recipe (no app needed). You can stop sharing at any time.',
      attestOk: 'Share',
      failedTitle: 'Web share',
      publishFailedBody: 'Could not create the share page. Check your connection and try again.',
      stopTitle: 'Stop web sharing',
      stopConfirm:
        'This deletes the share page. People with the link will no longer see it. Continue?',
      stopAction: 'Stop sharing',
      stopDoneBody: 'The share page has been deleted.',
      stopFailedBody: 'Could not stop sharing. Check your connection and try again.',
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
    shoppingAllOnList: 'The missing ingredients are already on your shopping list (not bought yet)',
    shoppingAlreadyOnList: {
      one: '{{count}} was already on the list',
      other: '{{count}} were already on the list',
    },
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

    bookShare: {
      action: 'Recipe book',
      title: 'Share a recipe book on the web',
      defaultTitle: 'Our recipe book',
      titlePlaceholder: 'Book name',
      countNote: {
        one: 'Bundles the {{count}} selected recipe into one page.',
        other: 'Bundles the {{count}} selected recipes into one page.',
      },
      excludedNote: {
        one: '({{count}} URL-imported recipe is excluded to respect original sources)',
        other: '({{count}} URL-imported recipes are excluded to respect original sources)',
      },
      attestNote:
        'Only content you created yourself can be shared. Anyone with the link can view it (no app needed). You can stop sharing anytime from Settings > Web shares.',
      publish: 'Share',
      createOnly: 'Create book without sharing',
      publishing: 'Creating…',
      failed: 'Could not create the share page. Check your connection and try again.',
      allExcluded:
        'All selected recipes were imported from URLs, so they cannot be shared on the web (to respect original sources).',
    },

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
        'Use the “Add” tab below to create a recipe from a photo with AI, plan one with AI, import one from a URL, or enter one by hand.',
    },
  },

  add: {
    heading: 'Add a recipe',
    subheading: 'Choose how to add it',
    method: {
      photo: 'From a photo',
      consult: 'Plan it with AI',
      consultDescription: 'Say what you feel like making and work it into a draft with AI',
      photoDescription: 'Turn a dish you ate out into a draft recipe',
      url: 'Import from a URL',
      urlDescription: 'Paste a link to a recipe page',
      text: 'From text',
      textDescription: 'Paste the text and turn it into a draft',
      ocr: 'From an image with text',
      ocrDescription: 'Read text from a cookbook or handwritten note',
      manual: 'By hand',
      manualDescription: 'Type the recipe from scratch',
    },
    coach: {
      photoTitle: 'AI recipes from a photo',
      photoText:
        'Pick a photo of a dish and AI drafts the ingredients, amounts and steps. Once the free allowance is used up, each short ad unlocks one more.',
      consultTitle: 'Not sure what to cook yet?',
      consultText:
        'Talk it through with AI — what you feel like, what you have at home — and turn it into a draft. Same free allowance and ads as photos.',
      manualTitle: 'By hand, when you want the detail',
      manualText:
        'Type it from scratch, with a cover photo, per-step photos and timers if you want them. Importing from a URL, text or an image with text never uses the AI allowance.',
    },
  },

  photo: {
    title: 'Turn a photo into a recipe',
    tabLabel: 'Photo to recipe',
    description:
      'Pick a photo of a dish and AI works out the ingredients, amounts and steps as a draft recipe. Add the restaurant name or a note about the taste and it lands closer to the original.',
    processing: 'Creating a recipe from your photo…',

    confidence: {
      high: 'Read it clearly',
      medium: 'Read most of it',
      low: 'Rough reading',
    },

    disclosure: {
      text: 'Your photo is sent to our server (and the AI provider) for analysis. It is not stored.',
      intent:
        'MUST state BOTH that the photo LEAVES the device to a third-party AI provider AND that ' +
        'it is not retained. This is the disclosure the user relies on before sending a photo; ' +
        'dropping either half misrepresents what happens to their data.',
    },

    offlineNotice: 'Connect to the internet to create recipes from photos',

    quotaRemaining: {
      one: '{{count}} free creation left · go unlimited',
      other: '{{count}} free creations left · go unlimited',
    },
    unlimitedByok: 'Your own AI key — unlimited',
    unlimitedPremium: 'Premium — unlimited',

    placeNamePlaceholder: 'Restaurant name (optional)',
    formTitle: 'Check and edit your recipe',

    savedAndPinned: 'Recipe saved and added to “Want to recreate”',
    saved: 'Recipe saved',

    webTitle: 'Photo recipes work in the app',
    webDescription:
      'Creating a draft from a photo is available in the mobile app (iOS / Android).\n\nIn a web browser, please enter the recipe by hand.',
    manualLabel: 'Enter it by hand instead',
    manualAction: 'Enter by hand',
    clearImage: 'Clear image',

    commentTitle: 'Add a note (optional)',
    commentHint: 'Mention the restaurant or how it tasted and the recipe lands closer.',
    commentPlaceholder: 'e.g. Mapo tofu at Chen’s — extra numbing',
    commentCancel: 'Cancel',
    commentConfirm: 'Create recipe',

    noImage: 'No image selected',
    labelSummary: 'Recipe created with AI',
    evidenceSummary: 'Created from a photo with AI',
    fallback: "We couldn't reach the AI, so we drafted something simple on your device",
    fallbackWithReason:
      "We couldn't reach the AI, so we drafted something simple on your device: {{reason}}",
  },

  cook: {
    loading: 'Loading…',
    switchTimerTitle: 'Switch timer',
    switchTimerBody:
      'A timer for step {{step}} is running. Stop it and start the timer for this step?',
    switchTimerAction: 'Switch',
    chipStep: '⏱ Step {{step}}',
    timerFinished: 'Done!',
    timerPaused: '{{time}} (paused)',
    startTimer: 'Start timer',
    detectedFromBody: ' (found in the step)',
    tapHint: 'Tap the screen to see the ingredients',
    prev: '← Back',
    finish: '✓ Done — record it',
    next: 'Next →',
  },

  revisions: {
    titleSuffix: '— version history',
    loading: 'Loading…',
    empty: 'No version history',
    revisionLabel: 'v{{number}} edit',
    current: 'Current',
    servings: '👥 serves {{count}}',
    cookTime: '⏱ {{count}} min',
    ingredientCount: '🥬 {{count}} ingredients',
    stepCount: '📋 {{count}} steps',
    stepLabel: 'Step {{number}}',
    metaTitle: 'Dish name',
  },

  refine: {
    title: 'Get closer to the restaurant taste',
    summaryLabel: 'What the AI changed',
    diffMeta: 'Recipe details',
    badge: {
      added: 'Added',
      removed: 'Removed',
      changed: 'Changed',
    },

    caution: {
      text: 'These are AI adjustments, and ingredients may have been added. If you have food allergies, check every ingredient before saving.',
      intent:
        'MUST warn that the AI MAY HAVE ADDED ingredients, and MUST tell the user to check every ' +
        'ingredient before saving. The app does NOT detect allergens — this sentence is the only ' +
        'warning. MUST NOT be softened to a generic "AI-generated" note.',
    },

    noticeNoChange:
      'Nothing in the recipe changed. Being more specific about the taste often helps.',

    feedbackLabel: 'How did it turn out?',
    feedbackPlaceholder: 'Much sweeter than the restaurant’s, and not thick enough…',
    feedbackHint:
      'The more you say about the taste (sweet, spicy, rich, bland), the better it can adjust.',

    photoLabel: 'Photo of what you cooked (optional)',
    photoHint: 'Browning, thickness and colour come across far better in a photo than in words.',
    targetLabel: 'Using the restaurant photo as the target',
    targetHint: 'Taken automatically from your “Ate out” record',

    retry: 'Start over',
    saveThis: 'Save these changes',
    processing: 'AI is adjusting…',
    start: 'Adjust with AI',
    updated: 'Recipe updated',

    notFound: 'Recipe not found',
    genericFailed: "We couldn't adjust the recipe. Please try again.",
    saveFailedTitle: "Couldn't save",
    saveFailedBody: "We couldn't save the recipe",

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
