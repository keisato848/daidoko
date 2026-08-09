import type ja from '../ja/recipeImport';

const recipeImport: typeof ja = {
  formTitle: 'Check and edit your recipe',
  saved: 'Recipe saved',

  text: {
    title: 'From text',
    heading: 'Paste the recipe text',
    copyPrompt: 'Copy AI instructions',
    copied: 'AI instructions copied',
    parsing: 'Parsing…',
    parse: 'Parse and review',
    // 訳ではなく作り直し。英語圏で自然な料理と書式にしてある
    samplePlaceholder: [
      'Beef stew',
      'Serves 4',
      'Ingredients',
      '500 g beef chuck',
      '2 carrots',
      '1 onion',
      'Method',
      '1. Cut everything into chunks.',
      '2. Brown the beef, then add the vegetables.',
      '3. Add stock and simmer until tender.',
    ].join('\n'),

    confidence: {
      high: 'Parsed cleanly',
      medium: 'Please check a few things',
      low: 'Some details are missing',
    },
    normalized: {
      gemmaNative: 'Tidied up with on-device AI',
      localHeuristic: 'Tidied up before parsing',
    },
  },

  ocr: {
    title: 'Read text from an image',
    heading: 'Read an image with text',
    lead: 'Reads text from cookbooks, handwritten notes and clippings on your device, and drafts the ingredients and steps.',
    formTitle: 'Check and edit what we read',
    reading: 'Reading on your device…',
    providerUnavailable: "This build couldn't start the Android OCR provider",
    providerNotConfigured: 'No on-device OCR provider was configured',
    failed: 'Text recognition failed',
    clearImage: 'Clear image',

    accuracy: {
      high: 'Reading accuracy: high',
      medium: 'Reading accuracy: medium',
      low: 'Reading accuracy: low',
    },

    webTitle: 'Text recognition is app-only',
    webDescription:
      'Camera text recognition is available first in the Android app.\n\nIn a web browser, please enter the recipe by hand.',
    manualLabel: 'Enter it by hand instead',
    manualAction: 'Enter by hand',

    appliedToForm: 'Read the text in the image and filled in the form',
    readButUnconvertible: "We read the text but couldn't turn it into a recipe",
    tooLittleText: 'There was little text in the image, so we drafted from image labels instead',
    skipped: 'Skipped reading text from the image',
    skippedWithReason: 'Skipped reading text from the image: {{reason}}',
    tooLittleTextRetry: 'There was too little text. Try a sharper image.',
    missingRequiredFields: "We couldn't read the fields a recipe needs",
  },

  url: {
    title: 'Import from a URL',
    heading: 'Paste the link to a recipe page',
    // 対象国のサイトに差し替え済み（日本のサイト名では通じない）
    supportedSites:
      'Works with recipe sites that publish JSON-LD — AllRecipes, Serious Eats, BBC Good Food and others',
    importing: 'Importing the recipe…',
    submit: 'Import',
    sourceLabel: 'Source:',
    required: 'Enter a URL',
    mustBeHttp: 'The URL must start with http or https',
    tooLong: 'That URL is too long',
    failed: 'Import failed',
    saved: 'Recipe saved!',
  },
};

export default recipeImport;
