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
};

export default family;
