import type ja from '../ja/byok';

const byok: typeof ja = {
  title: 'Your own AI key',
  heading: 'Your Gemini API key',
  lead: 'Add a key and photo recipes become unlimited — requests run directly with your key, without going through our server.',
  billingNote:
    'The key is stored encrypted on this device and is never sent anywhere but Google. Usage is billed to your own Google account.',

  inputPlaceholderNew: 'Paste a key starting with AIza…',
  inputPlaceholderReplace: 'Paste a new key to replace the saved one',
  save: 'Save',
  remove: 'Delete saved key',
  howTo: 'How to get a key (Google AI Studio)',

  invalidTitle: 'Heads up',
  invalidBody: "That doesn't look like a valid API key. Try pasting it again.",
  savedTitle: 'Saved',
  savedBody: 'Photo recipes are now unlimited, running on your own key.',
  saveFailedTitle: 'Heads up',
  saveFailedBody: "We couldn't save the key.",
  removeTitle: 'Delete key',
  removeConfirm: 'Delete the saved API key?',

  detail: {
    storageTitle: 'Where it is stored',
    storage: {
      text: 'The key is stored encrypted in your device’s secure store (Keystore on Android, Keychain on iPhone). It is never sent to DAIDOKO’s servers.',
      intent:
        'MUST state that the key is stored encrypted in the OS secure store AND that it is NEVER ' +
        "sent to this app's own server. Both halves are load-bearing: the user is deciding " +
        'whether to trust the app with a billable credential.',
    },

    destinationTitle: 'Where requests go',
    destination: {
      text: 'With a key saved, photo recipes are sent from your device straight to Google’s Gemini — DAIDOKO’s servers are not involved. Usage is billed directly to the Google account that issued the key.',
      intent:
        'MUST state where requests go (directly to Google, bypassing this app’s server) AND that ' +
        'the user’s own Google account is billed. Dropping the billing half hides a real cost.',
    },

    removalTitle: 'How to remove it',
    removal:
      'Use “Delete saved key” above at any time. Uninstalling the app also removes it, along with the device’s secure store entry.',

    migrationTitle: 'Backups and new devices',
    migration: {
      text: 'This key is deliberately not included in backups or transfer files. On a new device, paste the key again on this screen.',
      intent:
        'MUST state that the key is NOT included in backups or transfer files, and that the user ' +
        'must paste it again on a new device. Without this, the user discovers it only after ' +
        'migrating and finding the feature broken.',
    },

    supportedTitle: 'Supported keys',
    supported:
      'Only Google Gemini API keys work right now. Keys from other providers (OpenAI, Claude and so on) are not supported.',
  },
};

export default byok;
