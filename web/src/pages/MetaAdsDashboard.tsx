/**
 * Meta Ads Dashboard — Phase 5.1.
 *
 * The headline diagnostic page. Universal pattern:
 *   - Verdict bar  ("2 to scale, 1 to kill, 1 to refresh")
 *   - Money signal ("Overspending on X by ~$Y/day" OR "Headroom on Z: $W")
 *   - Per-ad table with pattern column + per-row WhyExpand
 *   - LockedModuleRail (empty until Phase 5.2)
 *
 * Backend: shells gyst-ops/ads/diagnostic/classifier.py via /api/ads/diagnostic.
 * Pure read view; logging "I took action on this ad" comes via /api/actions/log
 * (manual call from the WhyExpand action button — Phase 5.2).
 */

import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { VerdictBar } from '@/components/VerdictBar';
import { WhyExpand } from '@/components/WhyExpand';
import { LockedModuleRail } from '@/components/LockedModuleRail';
import { UnlockedModuleSection } from '@/components/UnlockedModuleSection';
import { useFetch } from '@/lib/useFetch';
import { Megaphone, DollarSign } from 'lucide-preact';

interface AdRow {
  ad_id: string;
  name: string;
  status: string;
  days_active: number;
  metrics: {
    spend: number;
    daily_spend: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpc: number;
    cpm: number;
    ctr_ratio_vs_median: number;
  };
  pattern: 'Proven Machine' | 'Dark Horse' | 'Unscaled Efficiency Play' | 'Stalled' | 'Underperformer' | 'Average';
  verdict: string;
  why: string;
}

interface MoneySignal {
  text: string;
  tone: 'normal' | 'urgent' | 'positive' | 'quiet';
  target_ad_id: string | null;
}

interface DiagnosticResponse {
  verdict_bar: { text: string; tone: 'normal' | 'urgent' | 'positive' | 'quiet' };
  money_signal: MoneySignal;
  ads: AdRow[];
  summary?: {
    total_active_ads: number;
    median_ctr: number;
    lookback_days: number;
    patterns: Record<string, number>;
  };
  thresholds_used?: string;
  fetched_at?: string;
  error?: string;
}

const PATTERN_TONE: Record<AdRow['pattern'], string> = {
  'Proven Machine': 'var(--color-status-success)',
  'Dark Horse': 'var(--color-accent)',
  'Unscaled Efficiency Play': 'var(--color-accent)',
  'Stalled': 'var(--color-text-muted)',
  'Underperformer': 'var(--color-status-failed)',
  'Average': 'var(--color-text-faint)',
};

const PATTERN_ORDER: Record<AdRow['pattern'], number> = {
  'Proven Machine': 0,
  'Dark Horse': 1,
  'Unscaled Efficiency Play': 2,
  'Stalled': 3,
  'Underperformer': 4,
  'Average': 5,
};

export function MetaAdsDashboard() {
  const { data, loading, error } = useFetch<DiagnosticResponse>('/api/ads/diagnostic', 60_000);

  const sortedAds = data?.ads
    ? [...data.ads].sort((a, b) => {
        const po = PATTERN_ORDER[a.pattern] - PATTERN_ORDER[b.pattern];
        if (po !== 0) return po;
        return b.metrics.daily_spend - a.metrics.daily_spend;
      })
    : [];

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Meta Ads" />
      <div class="flex-1 overflow-y-auto px-6 py-4">
        <VerdictBar
          text={data?.verdict_bar?.text || ''}
          tone={data?.verdict_bar?.tone}
          icon={<Megaphone size={18} />}
          loading={loading}
        />

        {data?.money_signal && (
          <VerdictBar
            text={data.money_signal.text}
            tone={data.money_signal.tone}
            icon={<DollarSign size={18} />}
          />
        )}

        {error && <PageState error={error} />}

        {data?.error && (
          <PageState
            empty
            emptyTitle="Classifier error"
            emptyDescription={data.error}
          />
        )}

        {data?.summary && (
          <div class="mb-4 text-[12px] text-[var(--color-text-muted)] flex flex-wrap items-center gap-3">
            <span>{data.summary.total_active_ads} active ads</span>
            <span>·</span>
            <span>account median CTR: <span class="text-[var(--color-text)]">{data.summary.median_ctr.toFixed(2)}%</span></span>
            <span>·</span>
            <span>last {data.summary.lookback_days} days</span>
            {Object.entries(data.summary.patterns).map(([pat, count]) => (
              count > 0 ? (
                <span key={pat} style={{ color: PATTERN_TONE[pat as AdRow['pattern']] }}>
                  {count} {pat.toLowerCase()}
                </span>
              ) : null
            ))}
          </div>
        )}

        {!loading && !error && sortedAds.length === 0 && !data?.error && (
          <PageState
            empty
            emptyTitle="No active ads"
            emptyDescription="The GYST ad account currently has 0 active ads. Ship a campaign and refresh to see the diagnostic surface."
          />
        )}

        {sortedAds.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full text-[13px]">
              <thead>
                <tr class="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
                  <th class="text-left py-2 px-2">Pattern</th>
                  <th class="text-left py-2 px-2">Ad</th>
                  <th class="text-right py-2 px-2">Spend</th>
                  <th class="text-right py-2 px-2">$/day</th>
                  <th class="text-right py-2 px-2">CTR</th>
                  <th class="text-right py-2 px-2">vs median</th>
                  <th class="text-left py-2 px-2">Verdict</th>
                  <th class="text-left py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedAds.map((ad) => (
                  <AdTableRow key={ad.ad_id} ad={ad} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <UnlockedModuleSection page="meta-ads" />
        <LockedModuleRail page="meta-ads" />
      </div>
    </div>
  );
}

function AdTableRow({ ad }: { ad: AdRow }) {
  return (
    <>
      <tr class="border-b border-[var(--color-border)] hover:bg-[var(--color-elevated)] transition-colors">
        <td class="py-2 px-2">
          <span
            class="inline-block px-2 py-0.5 rounded text-[11px] font-medium"
            style={{
              color: PATTERN_TONE[ad.pattern],
              backgroundColor: `color-mix(in srgb, ${PATTERN_TONE[ad.pattern]} 15%, transparent)`,
            }}
          >
            {ad.pattern}
          </span>
        </td>
        <td class="py-2 px-2 max-w-[280px] truncate" title={ad.name}>
          {ad.name}
        </td>
        <td class="py-2 px-2 text-right tabular-nums">${ad.metrics.spend.toFixed(0)}</td>
        <td class="py-2 px-2 text-right tabular-nums">${ad.metrics.daily_spend.toFixed(2)}</td>
        <td class="py-2 px-2 text-right tabular-nums">{ad.metrics.ctr.toFixed(2)}%</td>
        <td
          class="py-2 px-2 text-right tabular-nums"
          style={{
            color:
              ad.metrics.ctr_ratio_vs_median >= 1.5 ? 'var(--color-status-success)' :
              ad.metrics.ctr_ratio_vs_median <= 0.7 ? 'var(--color-status-failed)' :
              'var(--color-text-muted)',
          }}
        >
          {ad.metrics.ctr_ratio_vs_median.toFixed(1)}x
        </td>
        <td class="py-2 px-2 text-[var(--color-text-muted)]">{ad.verdict}</td>
        <td class="py-2 px-2">
          <WhyExpand label="why">
            <div class="text-[12px] text-[var(--color-text-muted)] leading-relaxed">
              {ad.why}
              <div class="mt-2 text-[11px] text-[var(--color-text-faint)]">
                {ad.metrics.impressions.toLocaleString()} impressions · {ad.metrics.clicks.toLocaleString()} clicks
                · CPC ${ad.metrics.cpc.toFixed(2)} · CPM ${ad.metrics.cpm.toFixed(2)}
                · {ad.days_active}d active
              </div>
            </div>
          </WhyExpand>
        </td>
      </tr>
    </>
  );
}
