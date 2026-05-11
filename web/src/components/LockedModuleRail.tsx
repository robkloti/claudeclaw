/**
 * LockedModuleRail — Phase 5.0.
 *
 * Universal sidebar/footer rail showing locked modules with one-line
 * preview + progress indicator. Drops into any client-facing page that
 * implements the Universal Diagnostic Pattern.
 *
 * Reads /api/modules/state?page=<page>. Renders nothing if no locked
 * modules (clean empty state — graceful when a page has none defined).
 */

import { useFetch } from '@/lib/useFetch';
import { Lock, Sparkles } from 'lucide-preact';

export interface ModuleStateRow {
  module_name: string;
  display_name: string;
  page: string;
  preview_description: string;
  tour_text: string;
  unlocked: boolean;
  unlocked_at: number | null;
  unlocked_by: 'earned' | 'operator' | null;
  progress_pct: number;
  preview_text: string;
  tour_seen: boolean;
}

export interface ModuleStateResponse {
  page: string;
  modules: ModuleStateRow[];
}

export interface LockedModuleRailProps {
  /** Page name to fetch modules for. Must match a ModulePage in types.ts. */
  page: string;
}

export function LockedModuleRail({ page }: LockedModuleRailProps) {
  const { data, loading } = useFetch<ModuleStateResponse>(
    `/api/modules/state?page=${encodeURIComponent(page)}`,
    60_000,
  );

  if (loading || !data?.modules) return null;
  const locked = data.modules.filter((m) => !m.unlocked);
  if (locked.length === 0) return null;

  return (
    <div class="mt-6 pt-4 border-t border-[var(--color-border)]">
      <h3 class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-2 flex items-center gap-1.5">
        <Lock size={10} />
        <span>Modules to unlock ({locked.length})</span>
      </h3>
      <div class="space-y-2">
        {locked.map((m) => (
          <LockedModuleRow key={m.module_name} module={m} />
        ))}
      </div>
    </div>
  );
}

function LockedModuleRow({ module }: { module: ModuleStateRow }) {
  return (
    <div class="p-2.5 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] opacity-80 hover:opacity-100 transition-opacity">
      <div class="flex items-start gap-2.5">
        <div class="flex-shrink-0 mt-0.5">
          <Sparkles size={13} class="text-[var(--color-text-faint)]" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[12.5px] font-medium text-[var(--color-text-muted)] truncate">
            {module.display_name}
          </div>
          <div class="text-[11.5px] text-[var(--color-text-faint)] mt-0.5 leading-snug">
            {module.preview_description}
          </div>
          <div class="mt-1.5 flex items-center gap-2">
            <div class="flex-1 h-1 rounded-full bg-[var(--color-elevated)] overflow-hidden">
              <div
                class="h-full bg-[var(--color-accent)] transition-all"
                style={{ width: `${Math.min(100, Math.max(0, module.progress_pct))}%` }}
              />
            </div>
            <span class="text-[10px] tabular-nums text-[var(--color-text-faint)]">
              {module.preview_text}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
