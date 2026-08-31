import type ja from '../ja/coverImage';

const coverImage: typeof ja = {
  action: 'Create an image with AI',
  actionDisabledHint: 'Enter a dish name first',
  actionHint: 'Each generation uses one from your free monthly credits',
  generating: 'Creating an image…',

  previewNotice: {
    text: 'This image was created by AI. The real dish may look different.',
    intent:
      'MUST make clear this image was AI-generated and MUST warn the actual dish may look ' +
      'different. This is the only label the user sees before adopting it as the recipe cover — ' +
      'softening it into a generic caption risks the image being mistaken for a real photo.',
  },
  useThis: 'Use this image',
  retry: 'Try again (uses 1)',
  cancel: 'Cancel',
  report: 'Report',

  badge: 'AI',
  detailNote: 'This image was created by AI. The real dish may look different.',

  adGate: {
    title: "You've used this month's free images",
    body: 'Watch a short ad to create one more image right now (used immediately, not banked).',
    watch: 'Watch ad',
  },

  error: {
    failed: 'Could not create the image. Please try again.',
  },
};

export default coverImage;
