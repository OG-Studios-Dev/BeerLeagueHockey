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

export function splitLeagueLeaderName(value: string): LeagueLeaderNameLines {
  const fullName = value.trim().split(/\s+/).filter(Boolean).join(' ') || 'Unknown';
  const [firstLine = 'Unknown', ...remaining] = fullName.split(' ');
  return { fullName, firstLine, secondLine: remaining.join(' ') };
}

export function formatLeagueLeaderGaa(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}
