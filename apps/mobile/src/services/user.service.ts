/**
 * User / family service — local-first family group management.
 * Cloud auth and cross-device sync can layer on top of the same contracts later.
 */
import { and, eq, ne } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { generateId } from '../utils/id';
import type {
  CurrentFamily,
  CurrentUser,
  FamilyMember,
  FamilyRole,
  JoinFamilyResult,
} from './types';

export const CURRENT_USER_ID = 'user-kei';
export const CURRENT_FAMILY_ID = 'family-001';

const DEFAULT_USER_NAME = 'あなた';
const DEFAULT_FAMILY_NAME = 'わたしの台所';
const DEFAULT_INVITE_CODE = 'DK0001';
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let mockCurrentUser: CurrentUser = {
  id: CURRENT_USER_ID,
  displayName: DEFAULT_USER_NAME,
};

let mockCurrentFamily: CurrentFamily = {
  id: CURRENT_FAMILY_ID,
  name: DEFAULT_FAMILY_NAME,
  inviteCode: DEFAULT_INVITE_CODE,
  ownerId: CURRENT_USER_ID,
  memberCount: 1,
};

let mockMembers: FamilyMember[] = [
  {
    id: 'member-family-001-user-kei',
    userId: CURRENT_USER_ID,
    displayName: DEFAULT_USER_NAME,
    avatarUrl: null,
    role: 'owner',
    joinedAt: new Date(0).toISOString(),
    isCurrentUser: true,
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeInviteCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
  }
  return code;
}

function familyFromMemberCount(
  family: typeof schema.families.$inferSelect,
  memberCount: number,
): CurrentFamily {
  return {
    id: family.id,
    name: family.name,
    inviteCode: family.inviteCode,
    ownerId: family.ownerId,
    memberCount,
  };
}

export function getCurrentUser(): CurrentUser {
  return mockCurrentUser;
}

export function getCurrentFamily(): CurrentFamily {
  return mockCurrentFamily;
}

export async function getCurrentUserProfile(): Promise<CurrentUser> {
  if (!isNativePlatform) return mockCurrentUser;

  const db = getDb();
  const rows = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, CURRENT_USER_ID))
    .limit(1);

  return rows[0] ?? mockCurrentUser;
}

export async function getCurrentFamilyProfile(): Promise<CurrentFamily> {
  if (!isNativePlatform) return { ...mockCurrentFamily, memberCount: mockMembers.length };

  const db = getDb();
  const familyRows = await db
    .select()
    .from(schema.families)
    .where(eq(schema.families.id, CURRENT_FAMILY_ID))
    .limit(1);

  if (familyRows.length === 0) return mockCurrentFamily;

  const memberRows = await db
    .select({ id: schema.familyMembers.id })
    .from(schema.familyMembers)
    .where(eq(schema.familyMembers.familyId, CURRENT_FAMILY_ID));

  return familyFromMemberCount(familyRows[0], memberRows.length);
}

export async function getFamilyMembers(): Promise<FamilyMember[]> {
  if (!isNativePlatform) return [...mockMembers];

  const db = getDb();
  const rows = await db
    .select({
      id: schema.familyMembers.id,
      userId: schema.familyMembers.userId,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
      role: schema.familyMembers.role,
      joinedAt: schema.familyMembers.joinedAt,
    })
    .from(schema.familyMembers)
    .leftJoin(schema.users, eq(schema.familyMembers.userId, schema.users.id))
    .where(eq(schema.familyMembers.familyId, CURRENT_FAMILY_ID));

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    displayName: row.displayName ?? '不明',
    avatarUrl: row.avatarUrl,
    role: row.role === 'owner' ? 'owner' : 'member',
    joinedAt: row.joinedAt,
    isCurrentUser: row.userId === CURRENT_USER_ID,
  }));
}

export async function updateCurrentUserDisplayName(displayName: string): Promise<CurrentUser> {
  const trimmed = displayName.trim();
  if (!trimmed) throw new RangeError('表示名を入力してください');
  if (trimmed.length > 32) throw new RangeError('表示名は32文字以内で入力してください');

  if (!isNativePlatform) {
    mockCurrentUser = { ...mockCurrentUser, displayName: trimmed };
    mockMembers = mockMembers.map((member) =>
      member.userId === CURRENT_USER_ID ? { ...member, displayName: trimmed } : member,
    );
    return mockCurrentUser;
  }

  const db = getDb();
  await db
    .update(schema.users)
    .set({ displayName: trimmed, updatedAt: nowIso() })
    .where(eq(schema.users.id, CURRENT_USER_ID));
  return { id: CURRENT_USER_ID, displayName: trimmed };
}

export async function updateCurrentFamilyName(name: string): Promise<CurrentFamily> {
  const trimmed = name.trim();
  if (!trimmed) throw new RangeError('グループ名を入力してください');
  if (trimmed.length > 40) throw new RangeError('グループ名は40文字以内で入力してください');

  if (!isNativePlatform) {
    mockCurrentFamily = { ...mockCurrentFamily, name: trimmed };
    return { ...mockCurrentFamily, memberCount: mockMembers.length };
  }

  const db = getDb();
  await db
    .update(schema.families)
    .set({ name: trimmed, updatedAt: nowIso() })
    .where(eq(schema.families.id, CURRENT_FAMILY_ID));
  return getCurrentFamilyProfile();
}

export async function addFamilyMember(
  displayName: string,
  role: FamilyRole = 'member',
): Promise<FamilyMember> {
  const trimmed = displayName.trim();
  if (!trimmed) throw new RangeError('メンバー名を入力してください');
  if (trimmed.length > 32) throw new RangeError('メンバー名は32文字以内で入力してください');

  const memberRole: FamilyRole = role === 'owner' ? 'owner' : 'member';
  const userId = generateId();
  const memberId = generateId();
  const joinedAt = nowIso();

  if (!isNativePlatform) {
    const member: FamilyMember = {
      id: memberId,
      userId,
      displayName: trimmed,
      avatarUrl: null,
      role: memberRole,
      joinedAt,
      isCurrentUser: false,
    };
    mockMembers = [...mockMembers, member];
    mockCurrentFamily = { ...mockCurrentFamily, memberCount: mockMembers.length };
    return member;
  }

  const db = getDb();
  await db.insert(schema.users).values({
    id: userId,
    displayName: trimmed,
    avatarUrl: null,
    createdAt: joinedAt,
    updatedAt: joinedAt,
  });
  await db.insert(schema.familyMembers).values({
    id: memberId,
    familyId: CURRENT_FAMILY_ID,
    userId,
    role: memberRole,
    joinedAt,
  });

  return {
    id: memberId,
    userId,
    displayName: trimmed,
    avatarUrl: null,
    role: memberRole,
    joinedAt,
    isCurrentUser: false,
  };
}

export async function removeFamilyMember(memberId: string): Promise<void> {
  if (!isNativePlatform) {
    const target = mockMembers.find((member) => member.id === memberId);
    if (!target) return;
    if (target.role === 'owner') throw new Error('オーナーは削除できません');
    mockMembers = mockMembers.filter((member) => member.id !== memberId);
    mockCurrentFamily = { ...mockCurrentFamily, memberCount: mockMembers.length };
    return;
  }

  const db = getDb();
  const rows = await db
    .select({ role: schema.familyMembers.role })
    .from(schema.familyMembers)
    .where(eq(schema.familyMembers.id, memberId))
    .limit(1);
  if (rows.length === 0) return;
  if (rows[0].role === 'owner') throw new Error('オーナーは削除できません');

  await db.delete(schema.familyMembers).where(eq(schema.familyMembers.id, memberId));
}

export async function rotateCurrentFamilyInviteCode(): Promise<CurrentFamily> {
  if (!isNativePlatform) {
    mockCurrentFamily = { ...mockCurrentFamily, inviteCode: generateInviteCode() };
    return { ...mockCurrentFamily, memberCount: mockMembers.length };
  }

  const db = getDb();
  let inviteCode = generateInviteCode();
  for (let attempts = 0; attempts < 5; attempts++) {
    const existing = await db
      .select({ id: schema.families.id })
      .from(schema.families)
      .where(
        and(eq(schema.families.inviteCode, inviteCode), ne(schema.families.id, CURRENT_FAMILY_ID)),
      )
      .limit(1);
    if (existing.length === 0) break;
    inviteCode = generateInviteCode();
  }

  await db
    .update(schema.families)
    .set({ inviteCode, updatedAt: nowIso() })
    .where(eq(schema.families.id, CURRENT_FAMILY_ID));
  return getCurrentFamilyProfile();
}

export async function joinFamilyByInviteCode(rawCode: string): Promise<JoinFamilyResult> {
  const inviteCode = normalizeInviteCode(rawCode);
  if (!inviteCode) throw new RangeError('招待コードを入力してください');

  if (!isNativePlatform) {
    if (inviteCode !== mockCurrentFamily.inviteCode) {
      throw new Error('招待コードが見つかりません');
    }
    return {
      status: 'already-member',
      family: { ...mockCurrentFamily, memberCount: mockMembers.length },
    };
  }

  const db = getDb();
  const familyRows = await db
    .select()
    .from(schema.families)
    .where(eq(schema.families.inviteCode, inviteCode))
    .limit(1);
  if (familyRows.length === 0) throw new Error('招待コードが見つかりません');

  const existingMember = await db
    .select({ id: schema.familyMembers.id })
    .from(schema.familyMembers)
    .where(
      and(
        eq(schema.familyMembers.familyId, familyRows[0].id),
        eq(schema.familyMembers.userId, CURRENT_USER_ID),
      ),
    )
    .limit(1);

  if (existingMember.length > 0) {
    const family = await getCurrentFamilyProfile();
    return { status: 'already-member', family };
  }

  await db.insert(schema.familyMembers).values({
    id: generateId(),
    familyId: familyRows[0].id,
    userId: CURRENT_USER_ID,
    role: 'member',
    joinedAt: nowIso(),
  });

  const family = await getCurrentFamilyProfile();
  return { status: 'joined', family };
}

export function resetFamilyServiceMockStateForTests(): void {
  mockCurrentUser = { id: CURRENT_USER_ID, displayName: DEFAULT_USER_NAME };
  mockCurrentFamily = {
    id: CURRENT_FAMILY_ID,
    name: DEFAULT_FAMILY_NAME,
    inviteCode: DEFAULT_INVITE_CODE,
    ownerId: CURRENT_USER_ID,
    memberCount: 1,
  };
  mockMembers = [
    {
      id: 'member-family-001-user-kei',
      userId: CURRENT_USER_ID,
      displayName: DEFAULT_USER_NAME,
      avatarUrl: null,
      role: 'owner',
      joinedAt: new Date(0).toISOString(),
      isCurrentUser: true,
    },
  ];
}
