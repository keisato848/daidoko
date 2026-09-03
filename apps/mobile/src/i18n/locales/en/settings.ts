import type ja from '../ja/settings';

const settings: typeof ja = {
  title: 'Settings',
  comingSoonStatus: 'Coming soon',
  comingSoonTitle: 'Not ready yet',
  comingSoonBody: 'This feature is planned for a future version.',

  plan: {
    sectionTitle: 'Plan',
    upgrade: 'Go Premium',
    /** Row label where purchases are unavailable. Do not tease Premium there. */
    free: 'Free plan',
    loading: 'Loading…',
    premium: 'Premium',
    premiumSubtitle: 'Premium — unlimited',
    premiumBody:
      'Your Premium plan is active. You can cancel any time from your store subscription settings.',
    byok: 'Your own AI key',
    byokSubtitle: 'Unlimited with your own key',
    freeRemaining: {
      one: 'Free — {{count}} left (then one per ad watched)',
      other: 'Free — {{count}} left (then one per ad watched)',
    },
  },

  byok: {
    label: 'Use your own AI key',
    configured: 'Set (unlimited)',
    notConfigured: 'Go unlimited with a Gemini key',
  },

  adPrivacy: {
    label: 'Ad privacy settings',
    subtitle: 'Change your consent for ads',
    failedTitle: 'Heads up',
    failedBody: "We couldn't open that settings screen. Please try again later.",
  },

  display: {
    sectionTitle: 'Display',
    unitSystem: 'Units',
    unitSystemBody:
      'Choose how amounts and temperatures are shown. What is stored does not change — only the way it is displayed.',
    unitMetric: 'Metric',
    unitImperial: 'US customary',
    unitMetricSubtitle: 'Shown in g, ml and °C',
    unitImperialSubtitle: 'Converted to oz, cups and °F',
  },

  reproduce: {
    sectionTitle: 'Recreating restaurant dishes',
    launchCamera: 'Open straight to the camera',
    launchCameraSubtitle: 'Right after you leave — one action from launch to a photo',
  },

  menu: {
    sectionTitle: 'Meal plan',
    label: 'Daily meal plan settings',
    subtitle: 'Auto-planning, notification time, and auto-adding missing ingredients',
  },

  account: {
    sectionTitle: 'Account',
    profile: 'Edit profile',
  },

  family: {
    sectionTitle: 'Family',
    group: 'Family group',
    groupSubtitle: {
      one: '{{name}} ({{count}} member)',
      other: '{{name}} ({{count}} members)',
    },
    invite: 'Invite family',
  },

  data: {
    sectionTitle: 'Data',
    backup: 'Backup & restore',
    backupSubtitle: 'Create and restore backups on this device',
    sync: 'Cloud sync',
    syncSubtitle: 'Join a family group and your devices stay in sync automatically',
    shareStatus: 'Sharing overview',
    shareStatusSubtitle: 'See what is shared with family and what is public by link',
    nameAliases: 'Ingredient name dictionary',
    nameAliasesSubtitle: {
      text: 'Ingredient names from your pantry and recipes are sent automatically to our server (and the AI provider) to match up spellings — only the names are sent. Review and fix what it has learned here',
      intent:
        'MUST state that this happens AUTOMATICALLY, without the user starting an AI feature, ' +
        'AND that ONLY ingredient names are sent. This is the only place the automatic ' +
        'transmission is disclosed; dropping either half contradicts the store listing and the ' +
        'privacy policy, which say sending happens on AI screens only.',
    },
    webShares: 'Recipe books',
    webSharesSubtitle: 'Create and edit books, and manage web sharing',
  },

  app: {
    sectionTitle: 'App',
    replayCoachMarks: 'Show the walkthrough again',
    replayCoachMarksSubtitle: 'Replay the guidance on every screen',
    coachMarksResetTitle: 'Walkthrough',
    coachMarksResetBody: 'The guidance will appear again as you open each screen.',
    version: 'Version',
    licenses: 'Licenses',
    licensesSubtitle: 'Open-source licenses used by this app',
  },

  coach: {
    planTitle: 'AI features and plans',
    planText:
      'AI features (photo recipes, ingredient matching, meal photos) are free once — after that, each ad you watch unlocks one use. Set a Gemini key under “Use your own AI key” to remove the limit.',
    backupTitle: 'Keeping your data safe',
    backupText:
      'Your data lives on this device (share with family and the shared items sync between your devices). Use “Backup & restore” to write it to a file and bring it back.',
    guideTitle: 'Walkthrough',
    guideText:
      'Tap “?” on main screens to replay their guidance. “Show the walkthrough again” brings the guidance back.',
  },
  webShares: {
    title: 'Recipe books',
    emptyTitle: 'No recipe books yet',
    emptyBody:
      'Create one from “+ New book” on the shelf in the recipe list (or long-press to select recipes, then tap “Recipe book”). Books you create can be edited and shared here.',
    recipeCount: {
      one: '{{count}} recipe',
      other: '{{count}} recipes',
    },
    shared: 'Shared',
    passcodeOn: 'Passcode set',
    legacyNote: 'Shared in the old format (can only be stopped)',
    send: 'Send link',
    stopTitle: 'Stop web sharing',
    stopConfirm:
      'This stops sharing. People with the link will no longer be able to see it. Continue?',
    stopAction: 'Stop sharing',
    stopFailed: 'Could not stop sharing. Check your connection and try again.',
    deleteTitle: 'Delete recipe book',
    deleteConfirm: 'Delete this book? (Your recipes themselves are not deleted.)',
  },
  shareStatus: {
    title: 'Sharing overview',
    familySection: 'Family group',
    familyJoined: 'In a family group',
    familyJoinedNote: 'See members and invite family here',
    familyNotJoined: 'Not in a family group',
    familyNotJoinedNote: 'Join one and devices in the group stay in sync automatically',
    familyScope:
      'Shared with the group: recipes, recipe books, shopping list, and pantry (visible only to group members). Cooking logs, photos, and menu plans are not shared.',
    linkSection: 'Public by link',
    linkScope:
      'Anyone with the link can view these — not just family. New viewers can open a link for 7 days after it was sent; sending it again resets the window.',
    linkEmpty: 'Nothing is public by link.',
    deletedRecipe: '(deleted recipe)',
    resend: 'Send link',
    stopTitle: 'Stop sharing',
    stopConfirm:
      'This stops sharing. People with the link will no longer be able to see it. Continue?',
    stopAction: 'Stop sharing',
    stopFailed: 'Could not stop sharing. Check your connection and try again.',
    sharedBooks: {
      one: '{{count}} shared recipe book',
      other: '{{count}} shared recipe books',
    },
    sharedBooksNote: 'Send or stop links from the recipe book manager',
    privateSection: 'Only-me items',
    privateScope:
      'Items marked “only me” are not shared with your family group. Change this on each item.',
    privateShopping: {
      one: '{{count}} shopping list item',
      other: '{{count}} shopping list items',
    },
    privatePantry: {
      one: '{{count}} pantry item',
      other: '{{count}} pantry items',
    },
  },
  book: {
    title: 'Recipe book',
    name: 'Book title',
    recipes: 'Recipes in this book',
    addRecipes: 'Add recipes',
    noRecipes: 'No recipes yet. Tap "Add recipes" to pick some.',
    excludedTag: 'Excluded when sharing (URL import)',
    accessTitle: 'Sharing options',
    passcodeLabel: 'Protect with a 6-digit passcode',
    passcodeInvalid: 'Enter a 6-digit numeric passcode.',
    expiryNone: 'No expiry',
    expiryDays: 'Expires in {{days}} days',
    shareNow: 'Share as a web page',
    applyUpdate: 'Apply changes (same link)',
    updated: 'The shared page was updated. The link stays the same.',
    sharedNote:
      'This book is shared. After changing its contents or settings, tap "Apply changes" to update the same link.',
  },
};

export default settings;
