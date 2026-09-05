import type ja from '../ja/report';

const report: typeof ja = {
  title: 'Report a problem',
  lead: "Let us know if there's a problem with AI-generated content. Please don't include personal information.",
  categoryLabel: 'Category',
  categoryInappropriate: 'Inappropriate content',
  categoryInaccurate: 'Inaccurate or odd',
  categoryOther: 'Other',
  textLabel: 'Details (optional)',
  textPlaceholder: 'Tell us what seemed wrong',
  submit: 'Send',
  submitting: 'Sending…',
  sentTitle: 'Sent',
  sentBody: 'Thanks for letting us know.',
  failedTitle: 'Heads up',
  failedBody: "We couldn't send this. Please try again later.",
};

export default report;
