import { getCurrentFamily, getCurrentUser } from '../user.service';

describe('user.service', () => {
  it('returns current user with id and displayName', () => {
    const user = getCurrentUser();
    expect(user.id).toBe('user-kei');
    expect(user.displayName).toBe('恵');
  });

  it('returns current family with id and name', () => {
    const family = getCurrentFamily();
    expect(family.id).toBe('family-001');
    expect(family.name).toBe('佐藤家の台所');
    expect(family.memberCount).toBe(3);
  });
});
