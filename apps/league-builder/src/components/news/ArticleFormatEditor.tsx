'use client';

import React from 'react';
import {
  AlignCenter,
  AlignLeft,
  ArrowDown,
  ArrowUp,
  Copy,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  MAX_ARTICLE_SECTIONS,
  MAX_SECTION_BODY_LENGTH,
  MAX_SECTION_HEADING_LENGTH,
  createArticleDocumentFromContent,
  isStructuredArticleContent,
  parseArticleDocument,
  serializeArticleDocument,
  type ArticleAppearance,
  type ArticleFontFamily,
  type ArticleHeadingStyle,
  type ArticleSection,
  type ArticleTextAlign,
} from '@hockey-life/ui/news-article-format';
import {
  reduceArticleDocument,
  type ArticleDocumentAction,
} from '@/lib/news/article-format-editor';

interface ArticleFormatEditorProps {
  value: string;
  onChange: (value: string) => void;
  title?: string;
  disabled?: boolean;
}

const inputClassName =
  'w-full rounded-xl border border-white/10 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-rink-500 focus:ring-2 focus:ring-rink-500/30 disabled:cursor-not-allowed disabled:opacity-60';

const titleFontPreviewClasses: Record<ArticleFontFamily, string> = {
  sans: 'font-sans',
  serif: 'font-serif',
  display: 'font-black uppercase tracking-tight',
};

const sectionFontPreviewClasses: Record<ArticleFontFamily, string> = {
  sans: 'font-sans',
  serif: 'font-serif',
  display: 'font-sans font-medium tracking-wide',
};

const headingPreviewClasses: Record<ArticleHeadingStyle, string> = {
  section: 'text-2xl font-extrabold tracking-tight text-white',
  subheading: 'text-lg font-bold text-neutral-100',
  eyebrow: 'text-xs font-bold uppercase tracking-[0.2em] text-rink-400',
};

const alignClasses: Record<ArticleTextAlign, string> = {
  left: 'text-left',
  center: 'text-center',
};

function previewParagraphs(body: string) {
  return body
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

export function ArticleFormatEditor({
  value,
  onChange,
  title = 'Article title preview',
  disabled = false,
}: ArticleFormatEditorProps) {
  const document = createArticleDocumentFromContent(value);
  const invalidStructuredContent = isStructuredArticleContent(value) && !parseArticleDocument(value);

  function commit(action: ArticleDocumentAction) {
    const nextDocument = reduceArticleDocument(document, action);
    if (nextDocument !== document) {
      onChange(serializeArticleDocument(nextDocument));
    }
  }

  function updateAppearance(patch: Partial<ArticleAppearance>) {
    commit({ type: 'update-appearance', patch });
  }

  function updateSection(index: number, patch: Partial<ArticleSection>) {
    commit({ type: 'update-section', index, patch });
  }

  const previewTitle = (
    <h4 className={`${titleFontPreviewClasses[document.appearance.titleFont]} ${
      document.appearance.titleStyle === 'statement'
        ? 'max-w-2xl text-4xl leading-none'
        : document.appearance.titleStyle === 'compact'
          ? 'max-w-xl text-2xl leading-tight'
          : 'max-w-2xl text-3xl leading-tight'
    } text-white`}>
      {title || 'Article title preview'}
    </h4>
  );

  return (
    <section
      aria-labelledby="article-format-heading"
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-6"
    >
      <div className="mb-6">
        <h2 id="article-format-heading" className="text-lg font-bold text-white">
          Article appearance
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          Build the story in sections and choose from safe, publication-ready styles.
        </p>
      </div>

      {invalidStructuredContent ? (
        <div role="alert" className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          This article uses malformed or unsupported rich data. Its stored content is preserved, but saving is blocked until you replace it with a safe draft below.
        </div>
      ) : null}

      <fieldset disabled={disabled} className="grid gap-4 border-0 p-0 sm:grid-cols-3">
        <legend className="sr-only">Title appearance</legend>
        <label className="block text-sm font-medium text-neutral-300">
          Title treatment
          <select
            aria-label="Title treatment"
            value={document.appearance.titleStyle}
            onChange={(event) => updateAppearance({ titleStyle: event.target.value as ArticleAppearance['titleStyle'] })}
            className={`${inputClassName} mt-2`}
          >
            <option value="classic">Classic</option>
            <option value="statement">Statement</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-neutral-300">
          Title layout
          <select
            aria-label="Title layout"
            value={document.appearance.titleLayout}
            onChange={(event) => updateAppearance({ titleLayout: event.target.value as ArticleAppearance['titleLayout'] })}
            className={`${inputClassName} mt-2`}
          >
            <option value="overlay">Overlay image</option>
            <option value="below-image">Below image</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-neutral-300">
          Headline font
          <select
            aria-label="Headline font"
            value={document.appearance.titleFont}
            onChange={(event) => updateAppearance({ titleFont: event.target.value as ArticleFontFamily })}
            className={`${inputClassName} mt-2`}
          >
            <option value="sans">Modern sans</option>
            <option value="serif">Editorial serif</option>
            <option value="display">Athletic display</option>
          </select>
        </label>
      </fieldset>

      <div className="mt-7 space-y-4">
        {document.sections.map((section, index) => (
          <fieldset
            key={section.id}
            disabled={disabled}
            className="rounded-2xl border border-white/10 bg-neutral-950/60 p-4 sm:p-5"
          >
            <legend className="px-1 text-sm font-bold text-white">Section {index + 1}</legend>
            <div className="mb-4 flex flex-wrap items-center justify-end gap-1.5">
              <button
                type="button"
                aria-label={`Move section ${index + 1} up`}
                title="Move section up"
                disabled={index === 0 || disabled}
                onClick={() => commit({ type: 'move-section', index, direction: -1 })}
                className="rounded-lg border border-white/10 p-2 text-neutral-300 hover:bg-white/10 disabled:opacity-30"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Move section ${index + 1} down`}
                title="Move section down"
                disabled={index === document.sections.length - 1 || disabled}
                onClick={() => commit({ type: 'move-section', index, direction: 1 })}
                className="rounded-lg border border-white/10 p-2 text-neutral-300 hover:bg-white/10 disabled:opacity-30"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Duplicate section ${index + 1}`}
                title="Duplicate section"
                disabled={document.sections.length >= MAX_ARTICLE_SECTIONS || disabled}
                onClick={() => commit({ type: 'duplicate-section', index })}
                className="rounded-lg border border-white/10 p-2 text-neutral-300 hover:bg-white/10 disabled:opacity-30"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Remove section ${index + 1}`}
                title="Remove section"
                disabled={document.sections.length === 1 || disabled}
                onClick={() => commit({ type: 'remove-section', index })}
                className="rounded-lg border border-red-500/20 p-2 text-red-300 hover:bg-red-500/10 disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-neutral-300 sm:col-span-2">
                Section {index + 1} heading <span className="text-neutral-500">(optional)</span>
                <input
                  type="text"
                  aria-label={`Section ${index + 1} heading`}
                  value={section.heading}
                  maxLength={MAX_SECTION_HEADING_LENGTH}
                  onChange={(event) => updateSection(index, { heading: event.target.value })}
                  placeholder="Add a section heading"
                  className={`${inputClassName} mt-2`}
                />
              </label>
              <label className="block text-sm font-medium text-neutral-300">
                Heading style
                <select
                  aria-label={`Section ${index + 1} heading style`}
                  value={section.headingStyle}
                  onChange={(event) => updateSection(index, { headingStyle: event.target.value as ArticleHeadingStyle })}
                  className={`${inputClassName} mt-2`}
                >
                  <option value="section">Section headline</option>
                  <option value="subheading">Subheading</option>
                  <option value="eyebrow">Eyebrow</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-neutral-300">
                Body font
                <select
                  aria-label={`Section ${index + 1} body font`}
                  value={section.fontFamily}
                  onChange={(event) => updateSection(index, { fontFamily: event.target.value as ArticleFontFamily })}
                  className={`${inputClassName} mt-2`}
                >
                  <option value="sans">Modern sans</option>
                  <option value="serif">Editorial serif</option>
                  <option value="display">Athletic display</option>
                </select>
              </label>
            </div>

            <div className="mt-4">
              <span className="block text-sm font-medium text-neutral-300">Text alignment</span>
              <div className="mt-2 flex gap-2" role="group" aria-label={`Section ${index + 1} text alignment`}>
                {(['left', 'center'] as const).map((align) => (
                  <button
                    key={align}
                    type="button"
                    aria-label={`${align === 'left' ? 'Left' : 'Center'} align section ${index + 1}`}
                    aria-pressed={section.align === align}
                    onClick={() => updateSection(index, { align })}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      section.align === align
                        ? 'border-rink-500/60 bg-rink-500/10 text-rink-300'
                        : 'border-white/10 text-neutral-400 hover:bg-white/5'
                    }`}
                  >
                    {align === 'left' ? <AlignLeft className="h-4 w-4" /> : <AlignCenter className="h-4 w-4" />}
                    {align === 'left' ? 'Left' : 'Center'}
                  </button>
                ))}
              </div>
            </div>

            <label className="mt-4 block text-sm font-medium text-neutral-300">
              Section {index + 1} body
              <textarea
                aria-label={`Section ${index + 1} body`}
                value={section.body}
                maxLength={MAX_SECTION_BODY_LENGTH}
                rows={8}
                onChange={(event) => updateSection(index, { body: event.target.value })}
                placeholder="Write this section. Blank lines create paragraphs; Markdown links remain clickable on the public article."
                className={`${inputClassName} mt-2 resize-y`}
              />
              <span className="mt-1 block text-xs text-neutral-500">
                {section.body.length.toLocaleString()}/{MAX_SECTION_BODY_LENGTH.toLocaleString()} characters
              </span>
            </label>
          </fieldset>
        ))}
      </div>

      <button
        type="button"
        disabled={disabled || document.sections.length >= MAX_ARTICLE_SECTIONS}
        onClick={() => commit({ type: 'add-section' })}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-rink-500/35 px-4 py-3 text-sm font-semibold text-rink-300 transition hover:border-rink-500/70 hover:bg-rink-500/10 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
      >
        <Plus className="h-4 w-4" />
        Add section
      </button>

      <div className="mt-8 border-t border-white/10 pt-6">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-neutral-400">Live preview</h3>
        <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900">
          {document.appearance.titleLayout === 'overlay' ? (
            <div
              aria-label="Preview image area"
              className="border-b border-white/10 bg-gradient-to-br from-neutral-800 to-neutral-950 p-6 pt-16"
            >
              {previewTitle}
            </div>
          ) : (
            <>
              <div
                aria-label="Preview image area"
                className="h-36 border-b border-white/10 bg-gradient-to-br from-neutral-800 to-neutral-950"
              />
              <div className="border-b border-white/10 bg-neutral-900 p-6">
                {previewTitle}
              </div>
            </>
          )}
          <div className="space-y-8 p-5 sm:p-7">
            {document.sections.map((section) => (
              <div key={section.id} className={`${sectionFontPreviewClasses[section.fontFamily]} ${alignClasses[section.align]}`}>
                {section.heading ? (
                  <h5 className={headingPreviewClasses[section.headingStyle]}>{section.heading}</h5>
                ) : null}
                <div className={`${section.heading ? 'mt-3' : ''} space-y-4 text-sm leading-7 text-neutral-300`}>
                  {previewParagraphs(section.body).map((paragraph, paragraphIndex) => (
                    <p key={paragraphIndex}>{paragraph}</p>
                  ))}
                  {!section.body.trim() ? <p className="italic text-neutral-500">Start writing this section...</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
