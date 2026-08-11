import type ja from '../ja/settings';

const settings: typeof ja = {
  title: 'Settings',
  comingSoonStatus: 'Coming soon',
  comingSoonTitle: 'Not ready yet',
  comingSoonBody: 'This feature is planned for a future version.',

  plan: {
    sectionTitle: 'Plan',
    upgrade: 'Go Premium',
    loading: 'Loading…',
    premium: 'Premium',
    premiumSubtitle: 'Premium — unlimited',
    premiumBody:
      'Your Premium plan is active. You can cancel any time from your store subscription settings.',
    byok: 'Your own AI key',
    byokSubtitle: 'Unlimited with your own key',
    freeRemaining: {
      one: 'Free — {{count}} left today',
      other: 'Free — {{count}} left today',
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
    syncSubtitle: 'Right now everything is stored on this device only',
    nameAliases: 'Ingredient name dictionary',
    nameAliasesSubtitle: 'Review and fix the names the AI has learned',
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
      'AI features (photo recipes, ingredient matching, meal photos) have a free daily allowance. Set a Gemini key under “Use your own AI key” to remove the limit.',
    backupTitle: 'Keeping your data safe',
    backupText:
      'Your data lives on this device. Use “Backup & restore” to write it to a file and bring it back.',
    guideTitle: 'Walkthrough',
    guideText:
      'Tap “?” on any screen to replay its guidance. “Show the walkthrough again” brings back the guidance on every screen.',
  },
};

export default settings;
