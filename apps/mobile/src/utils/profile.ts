import { t } from '../i18n';

export const UNSET_PROFILE_DISPLAY_NAME = t('family.noProfile');

export function formatProfileDisplayName(displayName: string): string {
  const trimmed = displayName.trim();
  return trimmed.length > 0 ? trimmed : UNSET_PROFILE_DISPLAY_NAME;
}
