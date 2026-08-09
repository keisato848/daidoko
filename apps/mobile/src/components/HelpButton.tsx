/**
 * Help button (?) — placed in the header of screens that carry coach marks.
 * Tapping replays that screen's guide immediately (useCoachMarks().show).
 */
import { CircleHelp } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { Colors } from '../constants/theme';
import { t } from '../i18n';

interface HelpButtonProps {
  onPress: () => void;
  size?: number;
}

export function HelpButton({ onPress, size = 18 }: HelpButtonProps) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={t('ui.help.label')}>
      <CircleHelp size={size} color={Colors.muted} />
    </Pressable>
  );
}
