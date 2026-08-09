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
  joinedTitle: 'Joined',
  joinedBody: 'You’ve joined {{name}}.',

  saveFailed: 'Saving failed',
  saveFailedTitle: 'Please check',
};

export default family;
