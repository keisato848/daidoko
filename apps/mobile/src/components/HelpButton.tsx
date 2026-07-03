/**
 * Help button (?) — placed in the header of screens that carry coach marks.
 * Tapping replays that screen's guide immediately (useCoachMarks().show).
 */
import { CircleHelp } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { Colors } from '../constants/theme';

interface HelpButtonProps {
  onPress: () => void;
  size?: number;
}

export function HelpButton({ onPress, size = 18 }: HelpButtonProps) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel="この画面の使い方を表示">
      <CircleHelp size={size} color={Colors.muted} />
    </Pressable>
  );
}
