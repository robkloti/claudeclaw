/**
 * VerdictBar — universal diagnostic dashboard pattern.
 *
 * The single-line headline at the top of every client-facing page. Tells the
 * viewer EXACTLY what to do today. Numbers without a verdict are noise —
 * this component is the first line of defense against that noise.
 *
 * Phase 4.3 of the AI-board port. See gyst-ops/PRP-aiboard-port.md
 * "Universal Diagnostic Dashboard Pattern" section.
 */

import type { ComponentChildren } from 'preact';

export interface VerdictBarProps {
  /** Pure text, < 100 chars. The dashboard headline. */
  text: string;
  /** Optional severity for visual treatment — affects the left accent color. */
  tone?: 'normal' | 'urgent' | 'positive' | 'quiet';
  /** Optional icon component (lucide-preact). */
  icon?: ComponentChildren;
  /** Optional secondary action (e.g. a "refresh" button). */
  action?: ComponentChildren;
  /** Loading state — shows a subtle pulse. */
  loading?: boolean;
}

export function VerdictBar({ text, tone = 'normal', icon, action, loading }: VerdictBarProps) {
  const accentColor = (() => {
    switch (tone) {
      case 'urgent': return 'var(--color-status-failed)';
      case 'positive': return 'var(--color-status-success)';
      case 'quiet': return 'var(--color-text-faint)';
      default: return 'var(--color-accent)';
    }
  })();

  return (
    <div
      class="flex items-center gap-3 px-4 py-3 mb-4 rounded-md border-l-4 bg-[var(--color-card)]"
      style={{ borderLeftColor: accentColor }}
    >
      {icon && <div class="flex-shrink-0" style={{ color: accentColor }}>{icon}</div>}
      <div
        class={[
          'flex-1 text-[14px] leading-snug text-[var(--color-text)]',
          loading ? 'opacity-60 animate-pulse' : '',
        ].join(' ')}
      >
        {text || (loading ? '…' : 'Quiet — nothing actionable right now.')}
      </div>
      {action && <div class="flex-shrink-0">{action}</div>}
    </div>
  );
}
