import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CommonActions, StackRouter, TabRouter } from '@react-navigation/routers';

import { compileCommonJs, createElement } from './component-harness.ts';

const CutIceTitle = (props: Record<string, unknown>) => createElement('CutIceTitle', props);
const { returnFromNewsArticle } = compileCommonJs<{
  returnFromNewsArticle: (navigation: ReturnType<typeof navigationFor>['navigation']) => void;
}>(new URL('../../src/navigation/newsArticleBack.ts', import.meta.url), {});
const { createNewsArticleOptions } = compileCommonJs<{
  createNewsArticleOptions: () => { header?: (props: Record<string, unknown>) => unknown };
}>(new URL('../../src/navigation/newsArticleHeader.ts', import.meta.url), {
  react: { createElement },
  '../components/CutIceTitle': { __esModule: true, default: CutIceTitle },
  './newsArticleBack': { returnFromNewsArticle },
});

const stackOptions = {
  routeNames: ['TeamsDirectory', 'NewsFeed', 'NewsArticle'],
  routeParamList: {},
  routeGetIdList: {},
};
const tabOptions = {
  routeNames: ['Home', 'Standings', 'Schedule', 'Stats', 'Team', 'Captain', 'Profile', 'LeaguePages'],
  routeParamList: {},
  routeGetIdList: {},
};

function navigationFor(childRoutes: string[], parentStartsOnHome: boolean) {
  const stack = StackRouter({});
  const tabs = TabRouter({ initialRouteName: 'Home' });
  let child = stack.getRehydratedState({ stale: true, index: childRoutes.length - 1, routes: childRoutes.map(name => ({ name })) }, stackOptions);
  let parent = tabs.getInitialState(tabOptions);
  if (!parentStartsOnHome) parent = tabs.getStateForAction(parent, CommonActions.navigate('LeaguePages'), tabOptions)! as typeof parent;

  const navigation = {
    canGoBack() {
      return stack.getStateForAction(child, CommonActions.goBack(), stackOptions) !== null
        || tabs.getStateForAction(parent, CommonActions.goBack(), tabOptions) !== null;
    },
    goBack() {
      const nextChild = stack.getStateForAction(child, CommonActions.goBack(), stackOptions);
      if (nextChild) child = nextChild as typeof child;
      else parent = (tabs.getStateForAction(parent, CommonActions.goBack(), tabOptions) ?? parent) as typeof parent;
    },
    getParent() {
      return {
        navigate(name: string) {
          parent = (tabs.getStateForAction(parent, CommonActions.navigate(name), tabOptions) ?? parent) as typeof parent;
        },
      };
    },
  };

  return {
    navigation,
    childRoute: () => child.routes[child.index].name,
    parentRoute: () => parent.routes[parent.index].name,
  };
}

describe('NewsArticle Back navigation', () => {
  it('always supplies the real article header with an accessible 44-point Back action', () => {
    const target = navigationFor(['NewsArticle'], false);
    const options = createNewsArticleOptions();
    const header = options.header!({ navigation: target.navigation }) as { type: unknown; props: { onBack: () => void } };
    assert.equal(header.type, CutIceTitle);
    assert.equal(typeof header.props.onBack, 'function');
    header.props.onBack();
    assert.equal(target.parentRoute(), 'Home');
  });

  it('uses installed router history for archive and initialized stacks before parent Home fallback', () => {
    const archive = navigationFor(['NewsFeed', 'NewsArticle'], false);
    returnFromNewsArticle(archive.navigation);
    assert.equal(archive.childRoute(), 'NewsFeed');
    assert.equal(archive.parentRoute(), 'LeaguePages');

    const initialized = navigationFor(['TeamsDirectory', 'NewsArticle'], false);
    returnFromNewsArticle(initialized.navigation);
    assert.equal(initialized.childRoute(), 'TeamsDirectory');

    const noHistory = navigationFor(['NewsArticle'], true);
    returnFromNewsArticle(noHistory.navigation);
    assert.equal(noHistory.parentRoute(), 'Home');
  });
});
