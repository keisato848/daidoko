import type ja from '../ja/error';

const error: typeof ja = {
  offline: {
    text: "You're offline. Reconnect and try again.",
    intent:
      'MUST convey: the user should reconnect, and doing so fixes it. ' +
      'MUST NOT be confusable with quota exhaustion (which waiting, not reconnecting, resolves).',
  },
  quotaExceeded: {
    text: "You've reached today's AI limit. Please try again tomorrow.",
    intent:
      'MUST convey: the daily limit is reached and the user must wait; retrying now will not help. ' +
      'MUST NOT be confusable with a network failure or a temporary server error.',
  },
  transient: {
    text: 'The AI service is busy. Please wait a moment and try again.',
    intent:
      'MUST convey: temporary congestion; retrying shortly is likely to succeed. ' +
      'MUST NOT be confusable with the daily quota being exhausted.',
  },
  photoRecipeFailed: {
    text: "We couldn't create a recipe from that photo. Please try again.",
    intent:
      'Generic fallback when the cause is unknown. MUST NOT claim a specific cause ' +
      '(network, quota, congestion) — the whole point is that we do not know which it was.',
  },
  notADish: {
    text: "We couldn't find a dish in that photo. Use a photo where the food is clearly visible.",
    intent:
      'MUST convey that the PHOTO is the problem and describe what a usable photo looks like. ' +
      'MUST NOT be a bare "try again" — retrying with the same photo cannot succeed.',
  },
  generic: 'Something went wrong. Please try again.',
  saveFailed: "Couldn't save",
  loadFailed: "Couldn't load",
};

export default error;
