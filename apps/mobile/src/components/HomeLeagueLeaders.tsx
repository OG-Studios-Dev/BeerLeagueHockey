import React from 'react';

import LeagueLeadersPresentation, { type LeagueLeadersPresentationProps } from './LeagueLeadersPresentation';

export type HomeLeagueLeadersProps = Omit<
  LeagueLeadersPresentationProps,
  'testIDPrefix' | 'focusPrefix' | 'showAllStats' | 'onOpenAllStats' | 'compactMetricTabs' | 'visibleLeaderLimit' | 'rowVariant' | 'sectionTitle' | 'showTeamCrests' | 'headingAccessory' | 'metricTabsAccessibilityLabel' | 'metricOptions'
>;

export default function HomeLeagueLeaders(props: HomeLeagueLeadersProps) {
  return (
    <LeagueLeadersPresentation
      {...props}
      testIDPrefix="home"
      focusPrefix="home"
      showAllStats={false}
      compactMetricTabs
      visibleLeaderLimit={5}
      rowVariant="home-inline"
      metricTabsAccessibilityLabel="Home League Leader metric"
    />
  );
}
