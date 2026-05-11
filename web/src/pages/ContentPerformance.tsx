/**
 * Content Performance — client-facing page using Universal Diagnostic Pattern.
 *
 * Verdict bar: top-line summary (counts by verdict + top performer if any).
 * Main diagnostic: posts grouped by verdict (Keep / Tweak / Kill / Pending),
 * each row expandable for "what hit" + "what flopped".
 *
 * Phase 4.3 (full). Reads /api/content-performance which parses
 * content/results/post-performance.md + content/repurpose/results.md.
 */

import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { VerdictBar } from '@/components/VerdictBar';
import { WhyExpand } from '@/components/WhyExpand';
import { LockedModuleRail } from '@/components/LockedModuleRail';
import { UnlockedModuleSection } from '@/components/UnlockedModuleSection';
import { useFetch } from '@/lib/useFetch';
import { TrendingUp, ExternalLink } from 'lucide-preact';

interface PostEntry {
  date: string;
  format: string;
  title: string;
  platform: string;
  hook: string;
  url: string;
  visual: string;
  metrics: string;
  what_hit: string;
  what_flopped: string;
  verdict: string;
  next_move: string;
  source: string;
}

interface ContentPerformanceResponse {
  verdict: string;
  verdict_tone: 'normal' | 'urgent' | 'positive' | 'quiet';
  entries: PostEntry[];
  summary: {
    total: number;
    counts: { keep: number; tweak: number; kill: number; pending: number };
  };
  window: { days: number; filtered_out: number };
}

const VERDICT_TONE: Record<string, { label: string; color: string; order: number }> = {
  keep: { label: 'Keep', color: 'var(--color-status-success)', order: 0 },
  tweak: { label: 'Tweak', color: 'var(--color-accent)', order: 1 },
  pending: { label: 'Pending metrics', color: 'var(--color-text-muted)', order: 2 },
  kill: { label: 'Kill', color: 'var(--color-status-failed)', order: 3 },
};

function verdictKey(verdict: string): string {
  const v = (verdict || 'pending').toLowerCase().trim();
  if (v.startsWith('keep')) return 'keep';
  if (v.startsWith('tweak')) return 'tweak';
  if (v.startsWith('kill')) return 'kill';
  return 'pending';
}

export function ContentPerformance() {
  const { data, loading, error } = useFetch<ContentPerformanceResponse>('/api/content-performance', 60_000);

  // Group entries by verdict bucket, ordered keep → tweak → pending → kill
  const grouped = (() => {
    if (!data?.entries) return [] as Array<{ key: string; label: string; color: string; entries: PostEntry[] }>;
    const map = new Map<string, PostEntry[]>();
    for (const e of data.entries) {
      const k = verdictKey(e.verdict);
      const arr = map.get(k) || [];
      arr.push(e);
      map.set(k, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (VERDICT_TONE[a]?.order ?? 99) - (VERDICT_TONE[b]?.order ?? 99))
      .map(([key, entries]) => ({
        key,
        label: VERDICT_TONE[key]?.label || key,
        color: VERDICT_TONE[key]?.color || 'var(--color-text-muted)',
        entries,
      }));
  })();

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Content Performance" />
      <div class="flex-1 overflow-y-auto px-6 py-4">
        <VerdictBar
          text={data?.verdict || ''}
          tone={data?.verdict_tone || 'quiet'}
          icon={<TrendingUp size={18} />}
          loading={loading}
        />

        {error && <PageState error={error} />}

        {data?.summary && data.summary.total > 0 && (
          <div class="mb-4 text-[12px] text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap">
            <span>{data.summary.total} posts in last {data.window?.days ?? 30} days</span>
            {data.window?.filtered_out > 0 && (
              <span class="text-[var(--color-text-faint)]">({data.window.filtered_out} older posts hidden)</span>
            )}
            <span>·</span>
            <span class="text-[var(--color-status-success)]">{data.summary.counts.keep} keep</span>
            <span class="text-[var(--color-accent)]">{data.summary.counts.tweak} tweak</span>
            <span class="text-[var(--color-text-muted)]">{data.summary.counts.pending} pending</span>
            <span class="text-[var(--color-status-failed)]">{data.summary.counts.kill} kill</span>
          </div>
        )}

        {!loading && !error && (!data?.entries || data.entries.length === 0) && (
          <PageState
            empty
            emptyTitle="No posts logged yet"
            emptyDescription="DM the bot 'log post [URL]' when you ship a post. 7 days later, drop the metrics and the loop closes."
          />
        )}

        <div class="space-y-6">
          {grouped.map((group) => (
            <section key={group.key}>
              <h3
                class="text-[11px] uppercase tracking-wider mb-2 flex items-center gap-2"
                style={{ color: group.color }}
              >
                <span>{group.label}</span>
                <span class="text-[var(--color-text-faint)]">({group.entries.length})</span>
              </h3>
              <div class="space-y-2">
                {group.entries.map((e) => (
                  <PostCard key={`${e.date}-${e.title}`} entry={e} accent={group.color} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <UnlockedModuleSection page="content-performance" />
        <LockedModuleRail page="content-performance" />
      </div>
    </div>
  );
}

function PostCard({ entry, accent }: { entry: PostEntry; accent: string }) {
  return (
    <div
      class="p-3 rounded-md border-l-4 border border-[var(--color-border)] bg-[var(--color-card)]"
      style={{ borderLeftColor: accent }}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 text-[11px] text-[var(--color-text-faint)]">
            <span>{entry.date}</span>
            <span>·</span>
            <span class="font-mono">{entry.format}</span>
            {entry.platform && (
              <>
                <span>·</span>
                <span>{entry.platform}</span>
              </>
            )}
            {entry.source === 'repurpose' && (
              <>
                <span>·</span>
                <span class="italic">repurpose</span>
              </>
            )}
          </div>
          <div class="text-[14px] font-medium text-[var(--color-text)] mt-1">{entry.title}</div>
          {entry.hook && entry.hook !== entry.title && (
            <div class="text-[12.5px] text-[var(--color-text-muted)] mt-1 italic">"{entry.hook}"</div>
          )}
        </div>
        {entry.url && (
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            class="flex-shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            title="Open post"
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>

      {entry.metrics && entry.metrics !== 'PENDING' && (
        <div class="mt-2 text-[12px] text-[var(--color-text-muted)] font-mono">{entry.metrics}</div>
      )}

      {(entry.what_hit || entry.what_flopped || entry.next_move) && (
        <div class="mt-2 pt-2 border-t border-[var(--color-border)]">
          <WhyExpand label="why">
            <div class="space-y-1.5">
              {entry.what_hit && entry.what_hit !== 'PENDING' && (
                <div><span class="text-[var(--color-status-success)]">Hit:</span> {entry.what_hit}</div>
              )}
              {entry.what_flopped && entry.what_flopped !== 'PENDING' && entry.what_flopped !== '—' && (
                <div><span class="text-[var(--color-status-failed)]">Flopped:</span> {entry.what_flopped}</div>
              )}
              {entry.next_move && entry.next_move !== 'PENDING' && (
                <div><span class="text-[var(--color-text-muted)]">Next:</span> {entry.next_move}</div>
              )}
            </div>
          </WhyExpand>
        </div>
      )}
    </div>
  );
}
