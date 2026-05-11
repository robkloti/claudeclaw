/**
 * UnlockedModuleSection — Phase 5.3.
 *
 * Universal renderer for unlocked module output. Drops into any client-facing
 * page that uses the Universal Diagnostic Pattern; reads /api/modules/state
 * for the page, fetches each unlocked module's classifier output, and renders
 * via a generic shape-detecting renderer.
 *
 * Per-module custom UI components can be added in `web/src/modules/<page>/<name>.tsx`
 * and registered in MODULE_RENDERERS below. Anything not in the registry uses
 * the generic auto-renderer that handles common shapes (arrays of cards,
 * key:value summaries, distribution bars).
 */

import { useFetch } from '@/lib/useFetch';
import { ModuleTour } from '@/components/ModuleTour';
import { Sparkles } from 'lucide-preact';
import type { ComponentType } from 'preact';
import type { ModuleStateRow, ModuleStateResponse } from './LockedModuleRail';

interface ModuleOutputResponse {
  module: string;
  output?: unknown;
  error?: string;
  locked?: boolean;
}

/**
 * Per-module custom UI components. Add new entries here when a module
 * needs a custom renderer (charts, tables, tooltips, etc.). Anything not
 * in this map falls through to GenericModuleRenderer.
 */
const MODULE_RENDERERS: Record<string, ComponentType<{ output: any }>> = {
  // Phase 5.3: per-module custom renderers go here.
  // Default fallback handles all current modules adequately for v1.
};

export interface UnlockedModuleSectionProps {
  page: string;
}

export function UnlockedModuleSection({ page }: UnlockedModuleSectionProps) {
  const { data, loading } = useFetch<ModuleStateResponse>(
    `/api/modules/state?page=${encodeURIComponent(page)}`,
    60_000,
  );

  if (loading || !data?.modules) return null;
  const unlocked = data.modules.filter((m) => m.unlocked);
  if (unlocked.length === 0) return null;

  return (
    <div class="mt-6 space-y-6">
      {unlocked.map((m) => (
        <UnlockedModule key={m.module_name} module={m} />
      ))}
    </div>
  );
}

function UnlockedModule({ module }: { module: ModuleStateRow }) {
  const { data, loading, error } = useFetch<ModuleOutputResponse>(
    `/api/modules/${encodeURIComponent(module.module_name)}/output`,
    60_000,
  );

  const Renderer = MODULE_RENDERERS[module.module_name];

  return (
    <section class="border-t border-[var(--color-border)] pt-4">
      <ModuleTour
        module_name={module.module_name}
        display_name={module.display_name}
        tour_text={module.tour_text}
        tour_seen={module.tour_seen}
      />
      <h3 class="text-[14px] font-medium text-[var(--color-text)] mb-2 flex items-center gap-2">
        <Sparkles size={14} class="text-[var(--color-accent)]" />
        <span>{module.display_name}</span>
        {module.unlocked_by === 'operator' && (
          <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
            (operator unlock)
          </span>
        )}
      </h3>
      {loading && (
        <div class="text-[12px] text-[var(--color-text-faint)] animate-pulse">Loading…</div>
      )}
      {error && (
        <div class="text-[12px] text-[var(--color-status-failed)]">Failed to load: {String(error)}</div>
      )}
      {data?.error && (
        <div class="text-[12px] text-[var(--color-status-failed)]">{data.error}</div>
      )}
      {data?.output && (
        Renderer
          ? <Renderer output={data.output} />
          : <GenericModuleRenderer output={data.output} />
      )}
    </section>
  );
}

/**
 * Auto-renders any classifier output. Detects common shapes:
 *   - Arrays of objects → table
 *   - Object with `total_*` / `count` keys → summary stats row
 *   - Object with arrays inside → list of subsections
 *   - Falls back to formatted JSON for unknown shapes
 */
function GenericModuleRenderer({ output }: { output: any }) {
  if (output === null || output === undefined) {
    return <div class="text-[12px] text-[var(--color-text-faint)]">No output.</div>;
  }
  if (typeof output === 'string' || typeof output === 'number' || typeof output === 'boolean') {
    return <div class="text-[13px] text-[var(--color-text)]">{String(output)}</div>;
  }
  if (Array.isArray(output)) {
    if (output.length === 0) return <div class="text-[12px] text-[var(--color-text-faint)]">(empty)</div>;
    return <ObjectArrayTable rows={output} />;
  }
  if (typeof output === 'object') {
    return <ObjectRenderer obj={output} />;
  }
  return <pre class="text-[11px] font-mono">{JSON.stringify(output, null, 2)}</pre>;
}

function ObjectRenderer({ obj }: { obj: Record<string, any> }) {
  const entries = Object.entries(obj);
  // Split scalars from nested arrays/objects
  const scalars = entries.filter(([, v]) => typeof v !== 'object' || v === null);
  const arrays = entries.filter(([, v]) => Array.isArray(v));
  const nestedObjs = entries.filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));

  return (
    <div class="space-y-3">
      {scalars.length > 0 && (
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          {scalars.map(([k, v]) => (
            <div key={k} class="text-[12px]">
              <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">{prettyKey(k)}</div>
              <div class="text-[var(--color-text)]">{formatScalar(v)}</div>
            </div>
          ))}
        </div>
      )}
      {arrays.map(([k, arr]) => (
        <div key={k}>
          <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1.5">{prettyKey(k)}</div>
          {Array.isArray(arr) && arr.length > 0
            ? (typeof arr[0] === 'object' && arr[0] !== null ? <ObjectArrayTable rows={arr as any[]} /> : <SimpleArrayList items={arr} />)
            : <div class="text-[12px] text-[var(--color-text-faint)]">(empty)</div>}
        </div>
      ))}
      {nestedObjs.map(([k, v]) => (
        <div key={k}>
          <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1.5">{prettyKey(k)}</div>
          <ObjectRenderer obj={v} />
        </div>
      ))}
    </div>
  );
}

function ObjectArrayTable({ rows }: { rows: any[] }) {
  if (!rows || rows.length === 0) return null;
  // Collect all unique keys across rows (cap at 8 columns)
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r || {})))).slice(0, 8);
  return (
    <div class="overflow-x-auto">
      <table class="w-full text-[12.5px]">
        <thead>
          <tr class="border-b border-[var(--color-border)] text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
            {cols.map((c) => (
              <th key={c} class="text-left py-1.5 px-2">{prettyKey(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((row, i) => (
            <tr key={i} class="border-b border-[var(--color-border)] hover:bg-[var(--color-elevated)] transition-colors">
              {cols.map((c) => (
                <td key={c} class="py-1.5 px-2 text-[var(--color-text)]">{formatScalar(row?.[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimpleArrayList({ items }: { items: any[] }) {
  return (
    <ul class="space-y-1">
      {items.slice(0, 20).map((item, i) => (
        <li key={i} class="text-[12.5px] text-[var(--color-text-muted)]">
          {typeof item === 'object' ? JSON.stringify(item) : String(item)}
        </li>
      ))}
    </ul>
  );
}

function prettyKey(k: string): string {
  return k.replace(/_/g, ' ');
}

function formatScalar(v: any): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '✓' : '×';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(2);
  }
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 100);
  return String(v).slice(0, 200);
}
