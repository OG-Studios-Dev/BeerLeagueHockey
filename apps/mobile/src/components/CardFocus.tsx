import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import React from 'react';
import {
  FlatList,
  ScrollView,
  SectionList,
  StyleSheet,
  View,
  type FlatListProps,
  type ScrollViewProps,
  type SectionListProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type FocusSurfaceProps = {
  focusScopeKey?: string;
  focusEnabled?: boolean;
  includeBottomTabInset?: boolean;
  accentColor?: string;
};

export function useBottomTabContentInset() {
  return React.useContext(BottomTabBarHeightContext) ?? 0;
}

function useInsetContentContainerStyle(
  contentContainerStyle: ScrollViewProps['contentContainerStyle'],
  includeBottomTabInset: boolean,
) {
  const bottomTabInset = useBottomTabContentInset();
  if (!includeBottomTabInset || bottomTabInset <= 0) return contentContainerStyle;
  const flattened = StyleSheet.flatten(contentContainerStyle);
  const effectiveBottomPadding = flattened?.paddingBottom ?? flattened?.paddingVertical ?? flattened?.padding;
  const existingPadding = typeof effectiveBottomPadding === 'number' && Number.isFinite(effectiveBottomPadding)
    ? effectiveBottomPadding
    : 0;
  return [contentContainerStyle, { paddingBottom: existingPadding + bottomTabInset }];
}

export const FocusScrollView = React.forwardRef<ScrollView, ScrollViewProps & FocusSurfaceProps>(function FocusScrollView(
  {
    accentColor: _accentColor,
    children,
    contentContainerStyle,
    focusEnabled: _focusEnabled,
    focusScopeKey: _focusScopeKey,
    includeBottomTabInset = true,
    ...props
  },
  forwardedRef,
) {
  const insetContentContainerStyle = useInsetContentContainerStyle(contentContainerStyle, includeBottomTabInset);
  return (
    <ScrollView {...props} ref={forwardedRef} contentContainerStyle={insetContentContainerStyle}>
      {children}
    </ScrollView>
  );
});

type FocusFlatListProps<ItemT> = FlatListProps<ItemT> & FocusSurfaceProps & {
  focusKeyExtractor?: (item: ItemT, index: number) => string;
  focusItems?: boolean;
};

function FocusFlatListInner<ItemT>(
  {
    accentColor: _accentColor,
    contentContainerStyle,
    focusEnabled: _focusEnabled,
    focusItems = true,
    focusKeyExtractor,
    focusScopeKey: _focusScopeKey,
    includeBottomTabInset = true,
    keyExtractor,
    renderItem,
    ...props
  }: FocusFlatListProps<ItemT>,
  forwardedRef: React.ForwardedRef<FlatList<ItemT>>,
) {
  const insetContentContainerStyle = useInsetContentContainerStyle(contentContainerStyle, includeBottomTabInset);
  const wrappedRenderItem = React.useCallback((info: Parameters<NonNullable<FlatListProps<ItemT>['renderItem']>>[0]) => {
    const rendered = renderItem?.(info) ?? null;
    if (!focusItems) return rendered;
    const id = focusKeyExtractor?.(info.item, info.index)
      ?? keyExtractor?.(info.item, info.index)
      ?? String((info.item as { id?: unknown; key?: unknown })?.id ?? (info.item as { key?: unknown })?.key ?? info.index);
    return <FocusCard focusId={`list:${id}`}>{rendered}</FocusCard>;
  }, [focusItems, focusKeyExtractor, keyExtractor, renderItem]);

  return (
    <FlatList
      {...props}
      ref={forwardedRef}
      contentContainerStyle={insetContentContainerStyle}
      keyExtractor={keyExtractor}
      renderItem={wrappedRenderItem}
    />
  );
}

export const FocusFlatList = React.forwardRef(FocusFlatListInner) as <ItemT>(
  props: FocusFlatListProps<ItemT> & { ref?: React.ForwardedRef<FlatList<ItemT>> },
) => React.ReactElement;

type FocusSectionListProps<ItemT, SectionT> = SectionListProps<ItemT, SectionT> & FocusSurfaceProps & {
  focusKeyExtractor?: (item: ItemT, index: number) => string;
  focusItems?: boolean;
};

function FocusSectionListInner<ItemT, SectionT>(
  {
    accentColor: _accentColor,
    contentContainerStyle,
    focusEnabled: _focusEnabled,
    focusItems = true,
    focusKeyExtractor,
    focusScopeKey: _focusScopeKey,
    includeBottomTabInset = true,
    keyExtractor,
    renderItem,
    ...props
  }: FocusSectionListProps<ItemT, SectionT>,
  forwardedRef: React.ForwardedRef<SectionList<ItemT, SectionT>>,
) {
  const insetContentContainerStyle = useInsetContentContainerStyle(contentContainerStyle, includeBottomTabInset);
  const wrappedRenderItem = React.useCallback((info: Parameters<NonNullable<SectionListProps<ItemT, SectionT>['renderItem']>>[0]) => {
    const rendered = renderItem?.(info) ?? null;
    if (!focusItems) return rendered;
    const id = focusKeyExtractor?.(info.item, info.index)
      ?? keyExtractor?.(info.item, info.index)
      ?? String((info.item as { id?: unknown; key?: unknown })?.id ?? (info.item as { key?: unknown })?.key ?? info.index);
    return <FocusCard focusId={`section:${id}`}>{rendered}</FocusCard>;
  }, [focusItems, focusKeyExtractor, keyExtractor, renderItem]);

  return (
    <SectionList
      {...props}
      ref={forwardedRef}
      contentContainerStyle={insetContentContainerStyle}
      keyExtractor={keyExtractor}
      renderItem={wrappedRenderItem}
    />
  );
}

export const FocusSectionList = React.forwardRef(FocusSectionListInner) as <ItemT, SectionT>(
  props: FocusSectionListProps<ItemT, SectionT> & { ref?: React.ForwardedRef<SectionList<ItemT, SectionT>> },
) => React.ReactElement;

export function FocusCard({ children, focusId, style, testID }: {
  children: React.ReactNode;
  focusId: string;
  focusScopeKey?: string;
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const wrapperTestID = testID ?? `focus-card-${focusId}`;
  return (
    <View collapsable={false} testID={wrapperTestID} style={style}>
      {children}
    </View>
  );
}
