import type ja from '../ja/pantry';

const pantry: typeof ja = {
  title: 'Pantry',
  shared: {
    onLabel: 'Shared with your family. Tap to make it private',
    offLabel: 'Private. Tap to share with your family',
    onBadge: 'Family',
    offBadge: 'Private',
    askTitle: 'Share your current list and pantry too?',
    askBody:
      'Choose Share to show the items you already have on your family’s devices. Choose Keep private to leave them to yourself; items you add from now on will be shared. You can change this per item later.',
    askYes: 'Share',
    askNo: 'Keep private',
  },

  empty: 'Your pantry is empty. Add some ingredients.',

  addPlaceholder: 'Add an ingredient (e.g. onion)',
  quantityLabel: 'Qty',
  unitLabel: 'Unit',

  action: {
    consumeMeal: 'Ate it',
    consumeMealLabel: 'Subtract what you ate from the pantry',
    receipt: 'Receipt',
    receiptLabel: 'Add from a receipt',
    scan: 'Scan',
    scanLabel: 'Scan a barcode',
    cookable: 'What can I cook with this',
    decrease: 'Decrease',
    increase: 'Increase',
  },

  lowStockBadge: 'Running low',
  thresholdBadge: 'Notify ≤',
  thresholdSet: 'Set a low-stock alert',
  group: {
    all: 'All',
    ungrouped: 'Unsorted',
    label: 'Location',
    pickerTitle: 'Choose a location',
    none: 'Leave unsorted',
    newPlaceholder: 'New location (e.g. Fridge)',
    create: 'Add',
    editLabel: 'Edit place and best-by',
  },

  expiry: {
    label: 'Best before',
    placeholder: '2026-09-30',
    clear: 'Clear',
    on: 'Best before {{date}}',
    invalid: 'Enter the date as 2026-09-30.',
  },

  thresholdTitle: 'Notify me when it drops to?',
  thresholdPlaceholder: 'e.g. 1',
  thresholdSaveLabel: 'Save threshold',
  thresholdClear: 'Clear',

  coach: {
    addTitle: 'Several ways to stock the pantry',
    addText:
      'Add things fast with “Scan” for barcodes or “Receipt” to read a shopping receipt. “Ate it” subtracts what you used from a meal photo.',
    notifyTitle: 'Low-stock alerts',
    notifyText:
      'Tap the bell on an item to say how low it can get before you want a reminder, and you’ll be told when it does.',
    cookableTitle: 'What you can cook right now',
    cookableText:
      'Matches your pantry against each recipe’s ingredients and ranks what you can cook today.',
  },

  shopping: {
    title: 'Shopping list',
    empty: 'Your shopping list is empty. Add something.',
    addPlaceholder: 'Add an item (e.g. milk)',
    movedToPantry: 'Moved {{name}} to the pantry',
    storeGroup: {
      all: 'All',
      ungrouped: 'Not set',
      label: 'Shop',
      pickerTitle: 'Choose a shop',
      none: 'Leave it unset',
      newPlaceholder: 'New shop (e.g. Supermarket)',
      editLabel: 'Change the shop',
    },
    buyLabel: 'Bought {{name}} (move to pantry)',
    uncheckLabel: 'Uncheck {{name}}',
    coach: {
      linkTitle: 'Connected to your pantry',
      linkText:
        'What you already have lives in the pantry. You can add just the missing ingredients from a recipe to this list.',
      moveTitle: 'Bought it → pantry',
      moveText: 'One tap moves the item into your pantry, with the amount read automatically.',
    },
  },

  consumeMeal: {
    title: 'Subtract a meal from the pantry',
    analyzing: 'Analysing your meal',
    lead: 'Photograph a meal and we’ll estimate what you used and subtract it (experimental).',
    capture: 'Photograph a meal',
    quotaRemaining: {
      one: 'Free analyses left: {{count}}',
      other: 'Free analyses left: {{count}}',
    },
    resultWithDish:
      'These are the pantry items used in “{{dish}}”.\nPick what to subtract, then confirm.',
    resultWithoutDish:
      'These are the pantry items used in this meal.\nPick what to subtract, then confirm.',
    retry: 'Start over',
    confirm: {
      one: 'Subtract ({{count}})',
      other: 'Subtract ({{count}})',
    },
    noMatch: 'We think this is “{{dish}}”, but nothing in your pantry matches it.',
    notRecognized: "We couldn't recognise the dish. Retake it head-on in good light.",
    failed: 'Analysis failed',
  },

  receipt: {
    title: 'Add to pantry from a receipt',
    reading: 'Reading your receipt',
    lead: 'Take or pick a photo of a receipt and we’ll read the items and add them all at once.',
    capture: 'Photograph a receipt',
    disclosure: {
      text: 'Reading uses a cloud AI. The photo is sent for analysis only and is not stored.',
      intent:
        'MUST state BOTH that the photo LEAVES the device to a cloud AI AND that it is not ' +
        'retained. Receipts carry purchase history; dropping either half misrepresents what ' +
        'happens to that data.',
    },
    disclosureOnDevice: {
      text: 'This device reads the text itself and sends only that text to a cloud AI to sort it into items. The photo stays on your device. If the text can’t be read, the photo is sent instead (for analysis only, and it is not stored).',
      intent:
        'MUST state ALL THREE: only the TEXT leaves the device on the normal path, the photo ' +
        'stays on the device on that path, AND the photo IS sent when the on-device read ' +
        'fails. Dropping the fallback makes this read as "the photo never leaves", which is ' +
        'false. Receipts carry purchase history.',
    },
    resultHint:
      'Here’s what we read. Uncheck what you don’t want, fix the names, amounts and units, then add. Rows with a blank amount go in without a tracked quantity.',
    quantityPlaceholder: 'Qty',
    quantityLabel: 'Amount (blank = quantity not tracked)',
    unitPlaceholder: 'Unit',
    unitLabel: 'Unit (e.g. pcs, g)',
    exclude: 'Exclude',
    include: 'Include',
    retry: 'Start over',
    confirm: {
      one: 'Add to pantry ({{count}})',
      other: 'Add to pantry ({{count}})',
    },
    checkOff: {
      one: 'Checking off {{count}} item on your shopping list',
      other: 'Checking off {{count}} items on your shopping list',
    },
    checkedOff: {
      one: 'Checked off {{count}} item on your shopping list',
      other: 'Checked off {{count}} items on your shopping list',
    },
    storeGroupTitle: 'Where do you shop at {{store}}?',
    storeGroupLabel: 'Shop',
    storeGroupUnset: 'Not set',
    notRecognized: "We couldn't read that receipt. Retake it with the whole receipt in frame.",
    noItems: "We couldn't find any items on that receipt. Retake it head-on in good light.",
    failed: 'Reading failed',
  },

  scan: {
    added: 'Added “{{name}}” to your pantry',
    permissionNeeded: 'Scanning barcodes needs camera access.',
    grantCamera: 'Allow camera',
    newProduct: 'New product',
    namePlaceholder: 'Product name (e.g. milk)',
    unitPlaceholder: 'Unit (optional, e.g. bottle)',
    addAndRemember: 'Add to pantry and remember',
    guide: 'Line the product barcode up inside the frame',
  },

  cookable: {
    title: 'Cook from your pantry',
    matching: 'Matching pantry names with AI…',
    watchAd: 'Watch an ad to match',
    watchAdRemaining: {
      one: '{{count}} AI match left — watch an ad to match',
      other: '{{count}} AI matches left — watch an ad to match',
    },
    empty: 'Add some recipes and pantry items and we’ll show what you can cook.',
    ready: 'Ready to cook',
    missing: {
      one: '{{count}} more: ',
      other: '{{count}} more: ',
    },
  },

  aliases: {
    title: 'Ingredient name dictionary',
    lead: 'Everything the AI has learned as “spelling variant → canonical name”. If it learned something wrong, fix the name with the pencil or remove it with × (removing it means the AI will guess again next time).',
    emptyTitle: 'Nothing learned yet.',
    emptyBody: 'Entries appear here as you use receipt reading and ingredient matching.',
    editLabel: 'Edit the canonical name for {{name}}',
    deleteLabel: 'Delete {{name}}',
    canonicalLabel: 'Correct name',
    saveLabel: 'Save canonical name',
  },
};

export default pantry;
