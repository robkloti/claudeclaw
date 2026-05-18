/**
 * Pipeline — client-facing page using the Universal Diagnostic Pattern.
 *
 * Verdict bar: top-line summary of campaign state.
 * Main diagnostic: campaigns sorted by reply rate, with pattern classification
 * as the leftmost column + per-row "why" expand showing the rule that fired.
 *
 * Phase 4.3 (full). Reads /api/pipeline which parses outreach/results/email-results.md.
 */

import { AtelierHero } from '@/components/AtelierHero';
import { PageState } from '@/components/PageState';
import { VerdictBar } from '@/components/VerdictBar';
import { WhyExpand } from '@/components/WhyExpand';
import { LockedModuleRail } from '@/components/LockedModuleRail';
import { UnlockedModuleSection } from '@/components/UnlockedModuleSection';
import { useFetch } from '@/lib/useFetch';
import { Activity } from 'lucide-preact';

interface Campaign {
  campaign_id: string;
  name: string;
  date: string;
  total: number;
  opens: number;
  open_rate: number;
  replies: number;
  reply_rate: number;
  status_code: number | null;
  pattern: string;
  verdict: string;
  why: string;
}

interface PipelineResponse {
  verdict: string;
  verdict_tone: 'normal' | 'urgent' | 'positive' | 'quiet';
  campaigns: Campaign[];
  summary: {
    total_campaigns: number;
    total_sent: number;
    total_replies: number;
    baseline_reply_rate: number;
    counts?: Record<string, number>;
  };
  window: { days: number; filtered_out: number };
}

const PATTERN_COLOR: Record<string, string> = {
  Hot: 'var(--color-status-success)',
  Warm: 'var(--color-accent)',
  'High-open Low-reply': 'var(--color-status-warning, #f59e0b)',
  Stalled: 'var(--color-status-failed)',
  Average: 'var(--color-text-muted)',
};

export function Pipeline() {
  const { data, loading, error } = useFetch<PipelineResponse>('/api/pipeline', 60_000);

  const replyRate = data?.summary?.total_sent
    ? ((data.summary.total_replies / data.summary.total_sent) * 100).toFixed(1) + '%'
    : '–';
  const baselineRate = data?.summary?.baseline_reply_rate
    ? (data.summary.baseline_reply_rate * 100).toFixed(1) + '%'
    : null;
  const hotCount = data?.summary?.counts?.['Hot'] ?? 0;
  const stalledCount = data?.summary?.counts?.['Stalled'] ?? 0;

  return (
    <div class="flex flex-col h-full">
      <AtelierHero
        title="Sales Pipeline"
        breadcrumb={['~/outreach', 'campaigns', 'live']}
        stats={[
          {
            label: 'CAMPAIGNS',
            big: String(data?.summary?.total_campaigns ?? 0),
            sub: `last ${data?.window?.days ?? 30} days`,
          },
          {
            label: 'REPLY RATE',
            big: replyRate,
            sub: baselineRate ? `baseline ${baselineRate}` : 'no baseline yet',
            tone: 'accent',
          },
          {
            label: 'HOT · STALLED',
            big: `${hotCount} · ${stalledCount}`,
            sub: hotCount > 0 ? 'follow up today' : stalledCount > 0 ? 'review the stalled' : 'queue is calm',
            tone: hotCount > 0 ? 'ok' : stalledCount > 0 ? 'warn' : 'muted',
          },
        ]}
      />
      <div class="flex-1 overflow-y-auto px-6 py-4">
        <VerdictBar
          text={data?.verdict || ''}
          tone={data?.verdict_tone || 'quiet'}
          icon={<Activity size={18} />}
          loading={loading}
        />

        {error && <PageState error={error} />}

        {data?.summary && data.summary.total_campaigns > 0 && (
          <div class="mb-4 text-[12px] text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap">
            <span>{data.summary.total_campaigns} campaigns in last {data.window?.days ?? 30} days</span>
            {data.window?.filtered_out > 0 && (
              <span class="text-[var(--color-text-faint)]">({data.window.filtered_out} older campaigns hidden)</span>
            )}
            <span>·</span>
            <span>{data.summary.total_sent.toLocaleString()} total sends</span>
            <span>·</span>
            <span>{data.summary.total_replies.toLocaleString()} replies</span>
            <span>·</span>
            <span>baseline: <span class="text-[var(--color-text)]">{(data.summary.baseline_reply_rate * 100).toFixed(2)}%</span></span>
          </div>
        )}

        {!loading && !error && (!data?.campaigns || data.campaigns.length === 0) && (
          <PageState
            empty
            emptyTitle="No campaigns yet"
            emptyDescription="Run the Instantly puller (Mon/Wed/Fri 7am scheduled task) to populate."
          />
        )}

        {data?.campaigns && data.campaigns.length > 0 && (
          <div class="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
            <table class="w-full text-[13px]">
              <thead style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: 2, color: 'var(--color-text-muted)', fontWeight: 600 }}>
                <tr class="border-b border-[var(--color-border)]">
                  <th class="text-left px-3 py-2.5">PATTERN</th>
                  <th class="text-left px-3 py-2.5">CAMPAIGN</th>
                  <th class="text-right px-3 py-2.5">LEADS</th>
                  <th class="text-right px-3 py-2.5">OPEN</th>
                  <th class="text-right px-3 py-2.5">REPLY</th>
                  <th class="text-left px-3 py-2.5">VERDICT</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((camp) => (
                  <tr key={camp.campaign_id} class="border-b border-[var(--color-border)] last:border-0">
                    <td class="px-3 py-2.5">
                      <span
                        class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${PATTERN_COLOR[camp.pattern] || 'var(--color-accent)'} 18%, transparent)`,
                          color: PATTERN_COLOR[camp.pattern] || 'var(--color-accent)',
                        }}
                      >
                        {camp.pattern}
                      </span>
                    </td>
                    <td class="px-3 py-2.5">
                      <div class="text-[var(--color-text)] truncate max-w-xs" title={camp.name}>{camp.name}</div>
                      <div class="text-[10.5px] text-[var(--color-text-faint)]">{camp.date}</div>
                    </td>
                    <td class="px-3 py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">{camp.total.toLocaleString()}</td>
                    <td class="px-3 py-2.5 text-right tabular-nums">
                      <div class="text-[var(--color-text)]">{(camp.open_rate * 100).toFixed(1)}%</div>
                      <div class="text-[10.5px] text-[var(--color-text-faint)]">{camp.opens.toLocaleString()}</div>
                    </td>
                    <td class="px-3 py-2.5 text-right tabular-nums">
                      <div class="text-[var(--color-text)]">{(camp.reply_rate * 100).toFixed(2)}%</div>
                      <div class="text-[10.5px] text-[var(--color-text-faint)]">{camp.replies.toLocaleString()}</div>
                    </td>
                    <td class="px-3 py-2.5">
                      <div class="text-[var(--color-text)]">{camp.verdict}</div>
                      <WhyExpand label="why">
                        <div>{camp.why}</div>
                      </WhyExpand>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <UnlockedModuleSection page="pipeline" />
        <LockedModuleRail page="pipeline" />
      </div>
    </div>
  );
}
