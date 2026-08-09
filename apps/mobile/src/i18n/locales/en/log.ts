import type ja from '../ja/log';

const log: typeof ja = {
  kind: {
    eatenOut: 'Ate out',
    cooked: 'Cooked at home',
  },

  freeform: 'Untitled record',

  form: {
    title: 'Record what you cooked',
    skip: 'Skip',
    congrats: 'Nicely done!',
    congratsSub: 'Save a record of today’s cooking',

    photoSection: 'Photos',
    photoLimitTitle: "Can't add more photos",
    photoLimit: {
      one: 'You can add up to {{count}} photo.',
      other: 'You can add up to {{count}} photos.',
    },
    addFromCamera: 'Add a photo with the camera',
    addFromGallery: 'Add a photo from your library',
    photoCount: '{{current}} / {{max}}',

    ratingSection: 'Rating',
    rating: {
      star1: 'Needs work',
      star2: 'Not bad',
      star3: 'Good',
      star4: 'Really good',
      star5: 'Perfect!',
    },

    memoSection: 'Notes (optional)',
    memoPlaceholder: 'Tweaks, things you noticed, reminders for next time…',

    submit: 'Save record',
    saved: 'Saved!',
    saveFailedTitle: "Couldn't save",
    saveFailedBody: "We couldn't save your record",

    refinePromptTitle: 'Apply this to the recipe?',
    refinePromptBody:
      'Using what you just wrote, AI will move the recipe closer to the restaurant taste.',
    refineLater: 'Later',
    refineNow: 'Adjust it',
  },
};

export default log;
