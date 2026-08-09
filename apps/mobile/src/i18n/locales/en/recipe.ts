import type ja from '../ja/recipe';

const recipe: typeof ja = {
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
  },
};

export default recipe;
