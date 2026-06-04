import { formatProfileDisplayName } from '../profile';

describe('profile utils', () => {
  it('formats an unset profile display name', () => {
    expect(formatProfileDisplayName('')).toBe('プロフィール未設定');
    expect(formatProfileDisplayName('   ')).toBe('プロフィール未設定');
  });

  it('keeps a configured profile display name', () => {
    expect(formatProfileDisplayName('台所係')).toBe('台所係');
  });
});
