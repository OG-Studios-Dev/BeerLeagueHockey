import React from 'react';
import {
  resolveArticleAppearance,
  type ArticleFontFamily,
  type ArticleTitleStyle,
} from '@hockey-life/ui/news-article-format';

interface ArticleHeroTitleProps {
  title: string;
  content: string | null | undefined;
  tone: 'light' | 'default';
}

const fontClasses: Record<ArticleFontFamily, string> = {
  sans: 'font-sans',
  serif: 'font-serif',
  display: 'font-black uppercase tracking-[-0.025em]',
};

const treatmentClasses: Record<ArticleTitleStyle, string> = {
  classic: 'max-w-4xl text-xl leading-[1.16] sm:text-3xl md:text-[2.75rem] md:leading-[1.1]',
  statement: 'max-w-5xl text-3xl leading-[1.02] sm:text-4xl md:text-5xl md:leading-[1.02]',
  compact: 'max-w-3xl text-lg leading-tight sm:text-2xl md:text-3xl',
};

export function ArticleHeroTitle({ title, content, tone }: ArticleHeroTitleProps) {
  const appearance = resolveArticleAppearance(content);

  return (
    <h1
      className={`${fontClasses[appearance.titleFont]} ${treatmentClasses[appearance.titleStyle]} font-extrabold ${
        tone === 'light' ? 'text-white' : 'text-[var(--color-text-primary)]'
      }`}
    >
      {title}
    </h1>
  );
}
