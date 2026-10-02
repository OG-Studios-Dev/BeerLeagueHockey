import type { NavigationProp, ParamListBase } from '@react-navigation/native';
export function returnFromNewsArticle(navigation: NavigationProp<ParamListBase>) {
  if (navigation.canGoBack()) {
    navigation.goBack();
    return;
  }

  navigation.getParent()?.navigate('Home');
}
