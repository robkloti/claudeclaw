/**
 * AtelierHero — editorial command-center page header per Atelier brand.
 *
 * Shape:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Mission CONTROL  v0.18 · ATELIER          ●live  pill           │
 *   │  ~/command-center / overview / live                              │
 *   │  ┌────┐ ┌────┐ ┌────┐                                             │
 *   │  │ st │ │ st │ │ st │   3 stat cards (italic serif numbers)      │
 *   │  └────┘ └────┘ └────┘                                             │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * The LAST word of the title renders italic in Newsreader serif. Stats
 * use serif italic for the big number, mono for label + sub.
 *
 * Designed in Claude Design (claude.ai/design); see chat handoff in
 * gyst-ops PRP-aiboard-port.md.
 */

import type { ComponentChildren } from 'preact';

export interface AtelierHeroStat {
  label: string;
  big: string;
  sub: string;
  /** Optional: tint the sub-line. Defaults to accent. */
  tone?: 'accent' | 'ok' | 'warn' | 'err' | 'muted';
}

export interface AtelierHeroProps {
  title: string;
  /** Path-style breadcrumb segments. Last segment renders in accent color. */
  breadcrumb?: string[];
  /** 3 stat cards rendered in a row. Optional — pass [] or omit to skip. */
  stats?: AtelierHeroStat[];
  /** Optional right-aligned status pill. Defaults to "live" with green dot. */
  livePill?: boolean | ComponentChildren;
  /** Optional version/system tag rendered next to the title in mono. */
  systemTag?: string;
}

const TONE_VAR: Record<NonNullable<AtelierHeroStat['tone']>, string> = {
  accent: 'var(--color-accent)',
  ok: 'var(--color-status-done)',
  warn: 'var(--color-status-running)',
  err: 'var(--color-status-failed)',
  muted: 'var(--color-text-muted)',
};

export function AtelierHero({
  title,
  breadcrumb = [],
  stats = [],
  livePill = true,
  systemTag = 'v0.18 · ATELIER',
}: AtelierHeroProps) {
  // Last word italic — matches "Mission *Control*", "Content *Performance*" etc.
  const words = title.split(' ');
  const italicWord = words.pop() ?? '';
  const restTitle = words.join(' ');

  return (
    <div
      class="border-b px-6 pt-7 pb-5 flex flex-col gap-4"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      {/* Title row */}
      <div class="flex items-end gap-4 flex-wrap">
        <div
          class="leading-none tracking-tight text-[var(--color-text)]"
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '38px',
            fontWeight: 400,
            letterSpacing: '-0.5px',
          }}
        >
          {restTitle ? <>{restTitle} </> : null}
          <span style={{ fontStyle: 'italic' }}>{italicWord}</span>
        </div>
        {systemTag && (
          <div
            class="text-[var(--color-text-faint)] pb-1"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 1 }}
          >
            {systemTag}
          </div>
        )}
        {livePill && (
          <div
            class="ml-auto inline-flex items-center gap-2 px-3 py-1 rounded-full border"
            style={{
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
            }}
          >
            {typeof livePill === 'boolean' ? (
              <>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    background: 'var(--color-status-done)',
                    boxShadow: '0 0 6px var(--color-status-done)',
                  }}
                />
                live
              </>
            ) : (
              livePill
            )}
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      {breadcrumb.length > 0 && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.4px',
            marginTop: -6,
          }}
        >
          {breadcrumb.map((seg, i) => {
            const isLast = i === breadcrumb.length - 1;
            return (
              <span key={i}>
                {i > 0 && (
                  <span style={{ color: 'var(--color-text-faint)', margin: '0 6px' }}>/</span>
                )}
                <span style={{ color: isLast ? 'var(--color-accent)' : undefined }}>{seg}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Stat row */}
      {stats.length > 0 && (
        <div class="flex gap-3 flex-wrap">
          {stats.map((s) => (
            <div
              key={s.label}
              class="flex-1 min-w-[140px] border rounded-xl px-5 py-4 flex flex-col gap-2"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-card)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: 2,
                  color: 'var(--color-text-muted)',
                  fontWeight: 600,
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 38,
                  fontWeight: 400,
                  lineHeight: 1,
                  letterSpacing: '-1px',
                  fontStyle: 'italic',
                  color: 'var(--color-text)',
                }}
              >
                {s.big}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10.5,
                  color: TONE_VAR[s.tone ?? 'accent'],
                  letterSpacing: '0.4px',
                }}
              >
                {s.sub}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
