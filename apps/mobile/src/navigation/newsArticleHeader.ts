import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import React from 'react';

import CutIceTitle from '../components/CutIceTitle';
import { returnFromNewsArticle } from './newsArticleBack';

export function createNewsArticleOptions(): NativeStackNavigationOptions {
  return {
    headerShown: true,
    header: ({ navigation }) => React.createElement(CutIceTitle, {
      title: 'News Article',
      onBack: () => returnFromNewsArticle(navigation),
    }),
  };
}
