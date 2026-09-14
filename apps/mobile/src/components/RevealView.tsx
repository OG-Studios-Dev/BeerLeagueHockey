import React from 'react';
import {
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';

type RevealViewProps = {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
};

export default function RevealView({
  children,
  style,
}: RevealViewProps) {
  return (
    <View style={style}>
      {children}
    </View>
  );
}
