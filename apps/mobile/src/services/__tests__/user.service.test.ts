jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
  getExpoDb: jest.fn(),
}));

import {
  addFamilyMember,
  getCurrentFamily,
  getCurrentFamilyProfile,
  getCurrentUser,
  getCurrentUserProfile,
  getFamilyMembers,
  joinFamilyByInviteCode,
  removeFamilyMember,
  resetFamilyServiceMockStateForTests,
  rotateCurrentFamilyInviteCode,
  updateCurrentFamilyName,
  updateCurrentUserDisplayName,
} from '../user.service';

describe('user.service', () => {
  beforeEach(() => {
    resetFamilyServiceMockStateForTests();
  });

  it('returns current user with id and displayName', () => {
    const user = getCurrentUser();
    expect(user.id).toBe('user-kei');
    expect(user.displayName).toBe('あなた');
  });

  it('returns current family with id and name', () => {
    const family = getCurrentFamily();
    expect(family.id).toBe('family-001');
    expect(family.name).toBe('わたしの台所');
    expect(family.inviteCode).toBe('DK0001');
    expect(family.memberCount).toBe(1);
  });

  it('updates current user and family names', async () => {
    await updateCurrentUserDisplayName('台所係');
    await updateCurrentFamilyName('週末の台所');

    await expect(getCurrentUserProfile()).resolves.toMatchObject({ displayName: '台所係' });
    await expect(getCurrentFamilyProfile()).resolves.toMatchObject({ name: '週末の台所' });
  });

  it('adds and removes local family members', async () => {
    const added = await addFamilyMember('健');
    expect(added.displayName).toBe('健');

    let members = await getFamilyMembers();
    expect(members.map((member) => member.displayName)).toEqual(['あなた', '健']);
    await expect(getCurrentFamilyProfile()).resolves.toMatchObject({ memberCount: 2 });

    await removeFamilyMember(added.id);
    members = await getFamilyMembers();
    expect(members.map((member) => member.displayName)).toEqual(['あなた']);
  });

  it('does not remove the owner member', async () => {
    const [owner] = await getFamilyMembers();
    await expect(removeFamilyMember(owner.id)).rejects.toThrow('オーナーは削除できません');
  });

  it('rotates invite code and validates join by code', async () => {
    const before = await getCurrentFamilyProfile();
    const after = await rotateCurrentFamilyInviteCode();
    expect(after.inviteCode).not.toBe(before.inviteCode);
    expect(after.inviteCode).toHaveLength(6);

    await expect(joinFamilyByInviteCode(after.inviteCode)).resolves.toMatchObject({
      status: 'already-member',
    });
    await expect(joinFamilyByInviteCode('UNKNOWN')).rejects.toThrow('招待コードが見つかりません');
  });
});
