import type ja from '../ja/paywall';

const paywall: typeof ja = {
  title: 'DAIDOKO Premium',
  subtitle: {
    one: 'You get {{count}} free AI recipe a month — after that, each ad you watch unlocks one more.\nWith Premium, use them as much as you like.',
    other:
      'You get {{count}} free AI recipes a month — after that, each ad you watch unlocks one more.\nWith Premium, use them as much as you like.',
  },

  benefit: {
    unlimited: 'Unlimited photo recipes',
    noWorry: 'No caps — create one the moment you think of it',
    future: 'Every new feature as it arrives',
  },

  priceFallback: 'Monthly subscription',
  priceUnit: '/ month (cancel any time)',
  priceUnitFallback: 'Cancel any time',
  subscribe: 'Start Premium',
  restore: 'Restore purchases',

  /**
   * Heading for platforms where purchases are unavailable. Avoids the word
   * "Premium" so we never advertise something that cannot be bought.
   */
  freeTitle: 'Get more AI recipes',
  freeSubtitle: {
    one: 'AI recipe creation is free for {{count}} use a month. After that, watch an ad to earn one more.',
    other:
      'AI recipe creation is free for {{count}} uses a month. After that, watch an ad to earn one more.',
  },

  terms: {
    text: 'The subscription is charged at purchase and renews automatically unless cancelled. You can cancel any time from your store account settings.',
    intent:
      'MUST state that the subscription auto-renews unless cancelled, that it is charged at ' +
      'purchase, and where to cancel. App store rules require all three; dropping any of them ' +
      'is both a policy violation and a misrepresentation of a recurring charge.',
  },

  /** Label for the links App Review guideline 3.1.2 requires. Do not drop the links. */
  eula: 'Terms of Use',
  privacyPolicy: 'Privacy Policy',

  /** The only way to go unlimited where purchases are unavailable. Keeps the screen from dead-ending. */
  useOwnKey: 'Use your own AI key',
  useOwnKeyHint: 'Set your own Gemini key to use it without any limit.',

  or: 'or',
  watchAd: 'Watch an ad to earn 1 credit',
  tokenHint: {
    text: 'Credits you earn never expire. Use them whenever you like.',
    intent:
      'MUST convey that earned credits DO NOT EXPIRE. They were day-scoped bonuses before and ' +
      'are now permanent tokens; implying they expire would make the reward look worthless.',
  },
  tokenBalance: {
    one: 'Credits earned: {{count}} left',
    other: 'Credits earned: {{count}} left',
  },

  thanksTitle: 'Thank you',
  adGranted: {
    one: "You've earned 1 photo recipe credit ({{count}} left).\nUse it whenever you like.",
    other: "You've earned 1 photo recipe credit ({{count}} left).\nUse it whenever you like.",
  },
  subscribed: "You're on Premium. Enjoy unlimited photo recipes.",

  noticeTitle: 'Heads up',
  adFailed: "We couldn't load an ad. Please try again later.",
  purchaseFailed: "We couldn't complete the purchase. Please try again later.",
  restoredTitle: 'Restored',
  restoredBody: 'Premium is active again.',
  nothingToRestore: 'We found no purchases to restore.',
  restoreFailed: 'Restoring purchases failed. Please try again later.',
};

export default paywall;
