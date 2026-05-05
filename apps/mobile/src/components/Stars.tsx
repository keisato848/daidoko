import { StyleSheet, Text } from 'react-native';

import { Colors } from '../constants/theme';

interface StarsProps {
  rating: number;
  size?: number;
}

export function Stars({ rating, size = 11 }: StarsProps) {
  const filled = '★'.repeat(rating);
  const empty = '☆'.repeat(5 - rating);

  return (
    <Text style={[styles.stars, { fontSize: size }]}>
      {filled}
      {empty}
    </Text>
  );
}

const styles = StyleSheet.create({
  stars: {
    color: Colors.gold,
    letterSpacing: 1,
  },
});
