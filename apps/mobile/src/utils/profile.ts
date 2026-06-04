export const UNSET_PROFILE_DISPLAY_NAME = 'プロフィール未設定';

export function formatProfileDisplayName(displayName: string): string {
  const trimmed = displayName.trim();
  return trimmed.length > 0 ? trimmed : UNSET_PROFILE_DISPLAY_NAME;
}
