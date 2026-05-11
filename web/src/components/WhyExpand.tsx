/**
 * WhyExpand — universal diagnostic dashboard pattern.
 *
 * Every verdict on every page is expandable to show the rule that fired +
 * supporting numbers. No black box. Click "why" → see the reasoning trace.
 *
 * Phase 4.3 of the AI-board port.
 */

import { useState } from 'preact/hooks';
import { ChevronRight } from 'lucide-preact';
import type { ComponentChildren } from 'preact';

export interface WhyExpandProps {
  /** Default state — collapsed unless explicitly overridden. */
  defaultOpen?: boolean;
  /** Label for the trigger — defaults to "why". */
  label?: string;
  /** Content shown when expanded. Usually the rule + the supporting numbers. */
  children: ComponentChildren;
}

export function WhyExpand({ defaultOpen = false, label = 'why', children }: WhyExpandProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div class="text-[12px]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors"
        aria-expanded={open}
      >
        <ChevronRight
          size={12}
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          class="transition-transform"
        />
        <span>{label}</span>
      </button>
      {open && (
        <div class="mt-2 ml-5 pl-3 border-l-2 border-[var(--color-border)] text-[var(--color-text-muted)] leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}
