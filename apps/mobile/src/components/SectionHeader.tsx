import { StyleSheet, Text, type TextStyle, View } from 'react-native';

import colors from '../theme/colors';

type SectionHeaderProps = {
  title: string;
};

export const SECTION_HEADING_TEXT_STYLE: TextStyle = {
  fontSize: 22,
  lineHeight: 28,
  fontWeight: '800',
  fontStyle: 'normal',
};

export default function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
  },
  title: {
    ...SECTION_HEADING_TEXT_STYLE,
    color: colors.textPrimary,
  },
});
