import React from 'react';
import {
  Animated,
  StyleProp,
  ViewStyle,
} from 'react-native';

import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';

type RevealViewProps = {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
};

export default function RevealView({
  children,
  delay = 0,
  distance = 18,
  duration = 380,
  style,
}: RevealViewProps) {
  const { reduceMotion } = useAccessibilityPreferences();
  const [progress] = React.useState(() => new Animated.Value(0));

  React.useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      useNativeDriver: true,
    });

    animation.start();

    return () => animation.stop();
  }, [delay, duration, progress, reduceMotion]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.985, 1],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
