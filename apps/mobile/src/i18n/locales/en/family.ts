import type ja from '../ja/family';

const family: typeof ja = {
  title: 'Family group',
  memberCount: {
    one: '{{count}} member',
    other: '{{count}} members',
  },

  role: {
    owner: 'Owner',
    member: 'Member',
  },

  profileSection: 'Profile',
  displayNamePlaceholder: 'Enter a display name',
  groupNamePlaceholder: 'Group name',

  membersSection: 'Members',
  you: ' (you)',
  memberNamePlaceholder: 'Member name',
  removeTitle: 'Remove member',
  removeConfirm: 'Remove {{name}} from the group?',

  inviteSection: 'Invite code',
  share: 'Share',
  rotate: 'Regenerate',
  shareMessage:
    'You’re invited to the DAIDOKO family group “{{name}}”.\nInvite code: {{code}}\nhttps://daidoko.app/join',
  shareTitle: 'DAIDOKO invite code',

  joinSection: 'Join with a code',
  joinPlaceholder: 'Invite code',
  alreadyMemberTitle: 'Already a member',
  alreadyMemberBody: 'You’re already in {{name}}.',
  joinedBody: 'You’ve joined {{name}}.',

  saveFailed: 'Saving failed',
  saveFailedTitle: 'Please check',

  defaultGroupName: 'My kitchen',
  noProfile: 'No profile set',

  validation: {
    displayNameTooLong: 'Display names can be up to 32 characters',
    groupNameRequired: 'Enter a group name',
    groupNameTooLong: 'Group names can be up to 40 characters',
    memberNameRequired: 'Enter a member name',
    memberNameTooLong: 'Member names can be up to 32 characters',
    cannotRemoveOwner: "The owner can't be removed",
    inviteCodeRequired: 'Enter an invite code',
    inviteCodeNotFound: 'That invite code was not found',
  },

  sync: {
    section: 'Share with family (cloud sync)',
    errorTitle: 'Sharing error',
    introNone:
      'Create a share group or join with an invite code, and recipes, recipe books, the shopping list and the pantry stay in sync across the group\u2019s devices.',
    consentTitle: 'Start sharing?',
    consentBody:
      'Recipes, recipe books, the shopping list and the pantry will be shared with the group\u2019s devices. Shopping and pantry items can be kept personal per item. You can leave at any time.',
    create: 'Create a share group',
    joinPlaceholder: 'Invite code (8 chars)',
    join: 'Join',
    joinedTitle: 'Joined',
    joinedBody: 'You joined the family share group.',
    createdTitle: 'Group created',
    createdBody: 'Share the invite code with your family so they can join.',
    inviteLabel: 'Invite code (valid for 24h)',
    inviteExpires: 'Expires: {{when}}',
    shareMessage:
      'Join my DAIDOKO family share. Enter this code under \u201cFamily group\u201d in the app: {{code}}',
    memberCountLabel: {
      one: 'Devices sharing: {{count}}',
      other: 'Devices sharing: {{count}}',
    },
    ownerBadge: 'You created this group',
    devices: {
      label: 'Devices sharing',
      self: 'This device',
      other: 'Device {{index}}',
      ownerMark: ' (creator)',
      lastSeen: 'Last synced: {{when}}',
      justNow: 'just now',
      today: 'today',
      daysAgo: {
        one: '{{count}} day ago',
        other: '{{count}} days ago',
      },
      evict: 'Remove',
      evictTitle: 'Remove this device?',
      evictBody:
        'This removes the device last synced {{when}} from sharing. Its own data stays on it, but it stops syncing. A new invite code will be issued (the removed device cannot rejoin with the old one).',
    },
    leave: 'Leave this group',
    leaveConfirmTitle: 'Leave the group?',
    leaveConfirmBody:
      'This device stops sharing. Everything already on this device stays. You\u2019ll need an invite code to join again.',
    deleteGroup: 'Delete the share group',
    deleteConfirmTitle: 'Delete the share group?',
    deleteConfirmBody: {
      text: 'The synced data on the server is erased and sharing stops on every device. Data stored on each device stays. Pages you published with web sharing are not deleted by this — stop a single shared recipe from its own detail menu, and a shared recipe book under Settings › Recipe books. This cannot be undone.',
      intent:
        'MUST scope the erasure to the SYNC server only, and MUST say that web-shared pages ' +
        'SURVIVE this and have to be stopped separately — a single shared recipe from its own ' +
        'detail menu, and a shared recipe book from Settings. The user decides an irreversible ' +
        'deletion from this text alone; implying it removes everything on the server would leave ' +
        'published pages online without them knowing, and naming only one of the two stop paths ' +
        'would leave the other kind of page stuck online too.',
    },
    offlineJoined: 'You are in a share group (details will show when online).',
    retry: 'Reload',
    unavailable: 'Sharing is being prepared on the server. Everything else works as usual.',
    error: {
      inviteInvalid: 'That invite code is not right. Please re-enter it.',
      inviteExpired: 'That invite code has expired. Ask the group creator to issue a new one.',
      groupFull: 'This group is full (up to 10 devices).',
      rateLimited: 'Too many attempts. Please wait a while and try again.',
      ownerOnly: 'Only the group creator can do this.',
      authInvalid:
        'The group could not be found (it may have been deleted). You are no longer joined.',
      alreadyJoined: 'You are already in a share group.',
      network: 'Could not connect. Please try again with a better connection.',
      server: 'A server error occurred. Please try again later.',
    },
  },
};

export default family;
