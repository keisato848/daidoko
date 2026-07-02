/**
 * Pressable with a subtle scale-down animation on press.
 * Uses the built-in Animated API (native driver) — no extra dependency.
 */
import { useRef } from 'react';
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface PressableScaleProps extends PressableProps {
  /** Target scale while pressed (default 0.96) */
  scaleTo?: number;
  /** Style for the inner Pressable */
  style?: StyleProp<ViewStyle>;
  /** Style for the animated wrapper (use flex:1 inside grid rows) */
  containerStyle?: StyleProp<ViewStyle>;
}

export function PressableScale({
  scaleTo = 0.96,
  style,
  containerStyle,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (value: number) => {
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
  };

  return (
    <Animated.View style={[containerStyle, { transform: [{ scale }] }]}>
      <Pressable
        style={style}
        onPressIn={(e) => {
          animateTo(scaleTo);
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          animateTo(1);
          onPressOut?.(e);
        }}
        {...rest}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
