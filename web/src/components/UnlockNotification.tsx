/**
 * UnlockNotification — Phase 5.0.
 *
 * Single-line notification that fires when a NEW module unlock happens
 * during the current session. Compares the module list across renders;
 * if a module flips from unlocked=false → unlocked=true, surfaces the
 * notification ONCE per session (then defers to the ModuleTour for the
 * persistent first-appearance flow).
 *
 * Shown at the top of the page, dismissable. Identical visual treatment
 * for earned + operator-gated unlocks (clients don't see operator attribution).
 */

import { useState, useEffect, useRef } from 'preact/hooks';
import { Sparkles, X } from 'lucide-preact';
import type { ModuleStateRow } from './LockedModuleRail';

export interface UnlockNotificationProps {
  modules: ModuleStateRow[] | undefined;
}

interface UnlockEvent {
  module_name: string;
  display_name: string;
}

export function UnlockNotification({ modules }: UnlockNotificationProps) {
  const [event, setEvent] = useState<UnlockEvent | null>(null);
  const previousState = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (!modules) return;
    // Detect newly-unlocked modules vs the previous render
    const justUnlocked: UnlockEvent[] = [];
    for (const m of modules) {
      const wasUnlocked = previousState.current[m.module_name] || false;
      if (m.unlocked && !wasUnlocked && Object.keys(previousState.current).length > 0) {
        justUnlocked.push({ module_name: m.module_name, display_name: m.display_name });
      }
      previousState.current[m.module_name] = m.unlocked;
    }
    // Surface ONE event at a time (the most recent unlock)
    if (justUnlocked.length > 0) {
      setEvent(justUnlocked[justUnlocked.length - 1]);
    }
  }, [modules]);

  if (!event) return null;

  return (
    <div class="fixed top-4 right-4 z-50 max-w-md animate-fade-in">
      <div class="p-3 rounded-md bg-[var(--color-card)] border border-[var(--color-accent)] shadow-lg flex items-start gap-2.5">
        <div class="flex-shrink-0 mt-0.5">
          <Sparkles size={16} class="text-[var(--color-accent)]" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-medium text-[var(--color-text)]">
            New module unlocked
          </div>
          <div class="text-[12px] text-[var(--color-text-muted)] mt-0.5">
            {event.display_name} is now available on this page.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEvent(null)}
          class="flex-shrink-0 p-1 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
