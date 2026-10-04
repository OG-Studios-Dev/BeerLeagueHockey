import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { getSurfacePalette, ui } from '../theme/ui';

type GlassSurfaceProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
};

export default function GlassSurface({ children, style, elevated = false }: GlassSurfaceProps) {
  const { reduceTransparency } = useAccessibilityPreferences();
  const palette = getSurfacePalette(reduceTransparency);

  return (
    <View
      style={[
        styles.surface,
        {
          backgroundColor: elevated ? palette.elevated : palette.surface,
          borderColor: palette.stroke,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderWidth: 1,
    borderRadius: ui.radius.panel,
    overflow: 'hidden',
  },
});
