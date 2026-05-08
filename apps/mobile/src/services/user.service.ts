/**
 * User service — current user and family info
 * In v0.5, returns hardcoded seed data (no auth yet)
 */

interface CurrentUser {
  id: string;
  displayName: string;
}

interface CurrentFamily {
  id: string;
  name: string;
  memberCount: number;
}

export function getCurrentUser(): CurrentUser {
  return {
    id: 'user-kei',
    displayName: '恵',
  };
}

export function getCurrentFamily(): CurrentFamily {
  return {
    id: 'family-001',
    name: '佐藤家の台所',
    memberCount: 3,
  };
}
