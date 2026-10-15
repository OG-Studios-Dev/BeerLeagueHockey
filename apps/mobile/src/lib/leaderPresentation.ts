export type LeagueLeaderNameLines = {
  fullName: string;
  firstLine: string;
  secondLine: string;
};

export type LeagueLeaderNameFit = {
  fontSize: number;
  lineHeight: number;
};

type LeagueLeaderNameFitOptions = {
  availableWidth: number;
  baseFontSize: number;
  minimumFontSize: number;
};

type LeagueLeaderLineSplitOptions = {
  availableWidth: number;
  fontSize: number;
};

function glyphAdvanceEm(character: string): number {
  if (/\s/.test(character)) return 0.35;
  if (/[MW@%&]/.test(character)) return 0.94;
  if (/[A-ZÀ-Þ]/.test(character)) return 0.72;
  if (/[ilIjtfr1]/.test(character)) return 0.43;
  if (/[-.'’]/.test(character)) return 0.38;
  return 0.62;
}

export function estimateLeagueLeaderLineWidth(value: string, fit: Pick<LeagueLeaderNameFit, 'fontSize'>): number {
  const advance = Array.from(value).reduce((total, character) => total + glyphAdvanceEm(character), 0);
  return advance * fit.fontSize * 1.04;
}

export function fitLeagueLeaderNameLine(value: string, options: LeagueLeaderNameFitOptions): LeagueLeaderNameFit {
  const availableWidth = Math.max(1, options.availableWidth);
  const minimumFontSize = Math.min(options.baseFontSize, Math.max(1, options.minimumFontSize));
  const widthAtBase = estimateLeagueLeaderLineWidth(value, { fontSize: options.baseFontSize });
  const fontSize = Math.max(
    minimumFontSize,
    Math.min(options.baseFontSize, widthAtBase > 0 ? options.baseFontSize * availableWidth / widthAtBase : options.baseFontSize),
  );
  return {
    fontSize: Math.floor(fontSize * 10) / 10,
    lineHeight: Math.ceil(fontSize * 1.32),
  };
}

export function splitLeagueLeaderLineLosslessly(
  value: string,
  options: LeagueLeaderLineSplitOptions,
): string[] {
  if (!value || estimateLeagueLeaderLineWidth(value, options) <= options.availableWidth) return [value];
  const characters = Array.from(value);
  const semanticBreaks = characters.flatMap((character, index) => (
    /\s/.test(character) || character === '-' ? [index + 1] : []
  )).filter((index) => index > 0 && index < characters.length);
  const allBreaks = Array.from({ length: characters.length - 1 }, (_, index) => index + 1);
  const scoreBreak = (index: number) => {
    const first = characters.slice(0, index).join('');
    const second = characters.slice(index).join('');
    const firstWidth = estimateLeagueLeaderLineWidth(first, options);
    const secondWidth = estimateLeagueLeaderLineWidth(second, options);
    return { index, first, second, widest: Math.max(firstWidth, secondWidth), imbalance: Math.abs(firstWidth - secondWidth) };
  };
  const semantic = semanticBreaks.map(scoreBreak);
  const fallback = allBreaks.map(scoreBreak);
  const fittingSemantic = semantic.filter((candidate) => candidate.widest <= options.availableWidth);
  const fittingFallback = fallback.filter((candidate) => candidate.widest <= options.availableWidth);
  const choices = fittingSemantic.length > 0
    ? fittingSemantic
    : fittingFallback.length > 0
      ? fittingFallback
      : semantic.length > 0 ? semantic : fallback;
  choices.sort((left, right) => left.widest - right.widest || left.imbalance - right.imbalance || left.index - right.index);
  const selected = choices[0];
  return selected ? [selected.first, selected.second] : [value];
}

export function splitLeagueLeaderName(value: string): LeagueLeaderNameLines {
  const fullName = value.trim().split(/\s+/).filter(Boolean).join(' ') || 'Unknown';
  const [firstLine = 'Unknown', ...remaining] = fullName.split(' ');
  return { fullName, firstLine, secondLine: remaining.join(' ') };
}

export function formatLeagueLeaderGaa(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}
