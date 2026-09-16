import Link from 'next/link';
import React, { Fragment } from 'react';
import {
  isStructuredArticleContent,
  parseArticleDocument,
  type ArticleFontFamily,
  type ArticleHeadingStyle,
  type ArticleTextAlign,
} from '@hockey-life/ui/news-article-format';
import { splitArticleParagraphIntoSegments, type ArticleMention } from '@/lib/articles/linkify';
import { splitRichTextParagraphs } from '@/lib/news/rich-text';

interface RichArticleContentProps {
  content: string | null | undefined;
  maxParagraphs?: number;
  paragraphClassName?: string;
  mentions?: ArticleMention[];
}

type Segment =
  | { type: 'text'; value: string }
  | { type: 'link'; label: string; href: string };

const sectionFontClasses: Record<ArticleFontFamily, string> = {
  sans: 'font-sans',
  serif: 'font-serif',
  display: 'font-sans font-medium tracking-wide',
};

const headingClasses: Record<ArticleHeadingStyle, string> = {
  section: 'text-2xl font-extrabold leading-tight tracking-tight text-[var(--color-text-primary)] md:text-3xl',
  subheading: 'text-xl font-bold leading-tight text-[var(--color-text-primary)] md:text-2xl',
  eyebrow: 'text-sm font-bold uppercase tracking-[0.2em] text-[var(--league-primary)]',
};

const alignClasses: Record<ArticleTextAlign, string> = {
  left: 'text-left',
  center: 'text-center',
};

function isSafeArticleHref(href: string): boolean {
  const value = href.trim();
  if (
    !value ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.includes('\\') ||
    value.startsWith('//')
  ) {
    return false;
  }
  if (
    value.startsWith('/') ||
    value.startsWith('#') ||
    /^https?:\/\//i.test(value) ||
    /^mailto:/i.test(value) ||
    /^tel:/i.test(value)
  ) {
    return true;
  }
  return !/^[a-z][a-z\d+.-]*:/i.test(value);
}

function parseInlineLinks(text: string): Segment[] {
  const regex = /\[([^\]]+)\]\(((?:[^()]|\([^)]*\))*)\)/g;
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }

    if (isSafeArticleHref(match[2])) {
      segments.push({
        type: 'link',
        label: match[1],
        href: match[2].trim(),
      });
    } else {
      segments.push({ type: 'text', value: match[1] });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return segments;
}

const linkClassName =
  'font-semibold text-[var(--league-primary)] underline decoration-[var(--league-primary)]/35 underline-offset-4 transition-colors hover:text-[var(--color-text-primary)]';

function limitParagraphsBySection(bodies: string[], maxParagraphs?: number): string[][] {
  const paragraphsBySection = bodies.map(splitRichTextParagraphs);
  const limit = maxParagraphs ?? Number.POSITIVE_INFINITY;

  return paragraphsBySection.map((paragraphs, sectionIndex) => {
    const precedingCount = paragraphsBySection
      .slice(0, sectionIndex)
      .reduce((count, precedingParagraphs) => count + precedingParagraphs.length, 0);
    return paragraphs.slice(0, Math.max(0, limit - precedingCount));
  });
}

function InlineArticleText({ text, mentions }: { text: string; mentions: ArticleMention[] }) {
  const segments = parseInlineLinks(text);

  return segments.map((segment, segmentIndex) => {
    if (segment.type === 'link') {
      return (
        <Link key={segmentIndex} href={segment.href} className={linkClassName}>
          {segment.label}
        </Link>
      );
    }

    if (mentions.length === 0) {
      return <Fragment key={segmentIndex}>{segment.value}</Fragment>;
    }

    const mentionSegments = splitArticleParagraphIntoSegments(segment.value, mentions);
    return (
      <Fragment key={segmentIndex}>
        {mentionSegments.map((mentionSegment, mentionSegmentIndex) => {
          if (!mentionSegment.href || !isSafeArticleHref(mentionSegment.href)) {
            return (
              <Fragment key={`${segmentIndex}-${mentionSegmentIndex}`}>
                {mentionSegment.text}
              </Fragment>
            );
          }

          return (
            <Link
              key={`${segmentIndex}-${mentionSegmentIndex}-${mentionSegment.href}`}
              href={mentionSegment.href}
              className={linkClassName}
            >
              {mentionSegment.text}
            </Link>
          );
        })}
      </Fragment>
    );
  });
}

export function RichArticleContent({
  content,
  maxParagraphs,
  paragraphClassName = 'mb-5 max-w-3xl text-base leading-8 text-[var(--color-text-secondary)] md:text-[1.0625rem]',
  mentions = [],
}: RichArticleContentProps) {
  const document = parseArticleDocument(content);

  if (document) {
    const hasContent = document.sections.some(
      (section) => section.heading.trim() || section.body.trim(),
    );
    if (!hasContent) {
      return <p className="text-[var(--color-text-muted)] italic">No content available.</p>;
    }

    const paragraphsBySection = limitParagraphsBySection(
      document.sections.map((section) => section.body),
      maxParagraphs,
    );

    return (
      <div className="space-y-10">
        {document.sections.map((section, sectionIndex) => {
          const paragraphs = paragraphsBySection[sectionIndex];
          if (!section.heading.trim() && paragraphs.length === 0) return null;

          return (
            <section
              key={section.id}
              className={`${sectionFontClasses[section.fontFamily]} ${alignClasses[section.align]}`}
            >
              {section.heading.trim() ? (
                <h2 className={`${headingClasses[section.headingStyle]} mb-4`}>
                  {section.heading.trim()}
                </h2>
              ) : null}
              {paragraphs.map((paragraph, paragraphIndex) => (
                <p key={paragraphIndex} className={paragraphClassName}>
                  <InlineArticleText text={paragraph} mentions={mentions} />
                </p>
              ))}
            </section>
          );
        })}
      </div>
    );
  }

  const paragraphs = isStructuredArticleContent(content)
    ? []
    : splitRichTextParagraphs(content).slice(
        0,
        maxParagraphs ?? Number.POSITIVE_INFINITY,
      );

  if (paragraphs.length === 0) {
    return <p className="text-[var(--color-text-muted)] italic">No content available.</p>;
  }

  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className={paragraphClassName}>
          <InlineArticleText text={paragraph} mentions={mentions} />
        </p>
      ))}
    </>
  );
}
