/**
 * ModuleTour — Phase 5.0.
 *
 * Single-line dismissable tour shown the FIRST TIME a newly-unlocked module
 * appears on a page. 2-3 sentences max. Persists "seen" state via
 * POST /api/modules/<name>/tour-seen so it doesn't re-show.
 *
 * Sits at the top of an unlocked module's section, BELOW the section header.
 */

import { useState } from 'preact/hooks';
import { Sparkles, X } from 'lucide-preact';
import { apiPost } from '@/lib/api';

export interface ModuleTourProps {
  module_name: string;
  display_name: string;
  tour_text: string;
  /** From the module state row — true means already dismissed. */
  tour_seen: boolean;
}

export function ModuleTour({ module_name, display_name, tour_text, tour_seen }: ModuleTourProps) {
  const [dismissed, setDismissed] = useState(tour_seen);
  if (dismissed) return null;

  const dismiss = async () => {
    setDismissed(true);
    try {
      await apiPost(`/api/modules/${encodeURIComponent(module_name)}/tour-seen`);
    } catch {
      // Non-fatal — re-show on next reload, no big deal
    }
  };

  return (
    <div class="mb-3 p-3 rounded-md bg-[var(--color-accent-soft)] border border-[var(--color-accent)] flex items-start gap-2.5">
      <div class="flex-shrink-0 mt-0.5">
        <Sparkles size={14} class="text-[var(--color-accent)]" />
      </div>
      <div class="flex-1 text-[12.5px] leading-relaxed text-[var(--color-text)]">
        <span class="font-medium">New: {display_name}.</span> {tour_text}
      </div>
      <button
        type="button"
        onClick={dismiss}
        class="flex-shrink-0 p-1 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        aria-label="Dismiss tour"
      >
        <X size={14} />
      </button>
    </div>
  );
}
