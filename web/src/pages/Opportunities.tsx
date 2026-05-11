/**
 * Opportunities — client-facing page using the Universal Diagnostic Pattern.
 *
 * Verdict bar: top action recommendation.
 * Main diagnostic: ranked list of 4 opportunity types from decide.py
 * (high_confidence_cluster, coverage_gap, contrary_take, evidence_winner).
 *
 * Phase 4.3 of the AI-board port. Reads /api/opportunities which shells
 * out to gyst-ops/lib/decide.py.
 */

import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { VerdictBar } from '@/components/VerdictBar';
import { WhyExpand } from '@/components/WhyExpand';
import { LockedModuleRail } from '@/components/LockedModuleRail';
import { UnlockedModuleSection } from '@/components/UnlockedModuleSection';
import { useFetch } from '@/lib/useFetch';
import { Sparkles } from 'lucide-preact';

interface Opportunity {
  rank: number;
  opportunity_type: 'high_confidence_cluster' | 'coverage_gap' | 'contrary_take' | 'evidence_winner';
  title: string;
  description: string;
  category: string;
  supporting_items: string[];
  score: number;
  evidence_count?: number;
}

interface OpportunitiesResponse {
  opportunities: Opportunity[];
  category_coverage: Array<{
    category: string;
    tactic_count: number;
    avg_confidence: number;
    high_confidence_count: number;
  }>;
  knowledge_stats: {
    tactics: number;
    frameworks: number;
    patterns: number;
    categories_with_tactics: number;
    avg_confidence_across_all: number;
  };
  error?: string;
}

const TYPE_ORDER: Record<Opportunity['opportunity_type'], number> = {
  evidence_winner: 0,
  high_confidence_cluster: 1,
  contrary_take: 2,
  coverage_gap: 3,
};

const TYPE_LABEL: Record<Opportunity['opportunity_type'], string> = {
  evidence_winner: 'Proven Winner',
  high_confidence_cluster: 'Deep Dive',
  contrary_take: 'Contrary Take',
  coverage_gap: 'Coverage Gap',
};

const TYPE_TONE: Record<Opportunity['opportunity_type'], 'normal' | 'urgent' | 'positive' | 'quiet'> = {
  evidence_winner: 'positive',
  high_confidence_cluster: 'normal',
  contrary_take: 'urgent',
  coverage_gap: 'quiet',
};

export function Opportunities() {
  const { data, loading, error } = useFetch<OpportunitiesResponse>('/api/opportunities?limit=10', 60_000);

  // Verdict logic — pick the highest-priority, highest-score opportunity.
  // Prioritizes evidence_winners > high_confidence_clusters > contrary_takes > coverage_gaps.
  const verdict = (() => {
    if (!data?.opportunities?.length) {
      const stats = data?.knowledge_stats;
      if (stats && stats.tactics < 3) {
        return {
          text: `Wiki is sparse — only ${stats.tactics} tactics across ${stats.categories_with_tactics}/12 categories. Use the tactic-add skill to seed from raw clips before opportunities can surface meaningfully.`,
          tone: 'quiet' as const,
        };
      }
      return { text: 'No opportunities scoring above threshold today. Check back after the next research-sweep or feedback-synth.', tone: 'quiet' as const };
    }
    // Sort by type priority first, then score within type
    const sorted = [...data.opportunities].sort((a, b) => {
      const ta = TYPE_ORDER[a.opportunity_type];
      const tb = TYPE_ORDER[b.opportunity_type];
      if (ta !== tb) return ta - tb;
      return b.score - a.score;
    });
    const top = sorted[0];
    return {
      text: `Top action: ${top.title} (${TYPE_LABEL[top.opportunity_type]}, score ${(top.score * 100).toFixed(0)}/100). ${top.description}`,
      tone: TYPE_TONE[top.opportunity_type],
    };
  })();

  // Group opportunities by type for display
  const grouped = (() => {
    if (!data?.opportunities) return [] as Array<{ type: Opportunity['opportunity_type']; items: Opportunity[] }>;
    const map = new Map<Opportunity['opportunity_type'], Opportunity[]>();
    for (const o of data.opportunities) {
      const arr = map.get(o.opportunity_type) || [];
      arr.push(o);
      map.set(o.opportunity_type, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => TYPE_ORDER[a] - TYPE_ORDER[b])
      .map(([type, items]) => ({ type, items: items.sort((a, b) => b.score - a.score) }));
  })();

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Opportunities" />

      <div class="flex-1 overflow-y-auto px-6 py-4">
        <VerdictBar
          text={verdict.text}
          tone={verdict.tone}
          icon={<Sparkles size={18} />}
          loading={loading}
        />

        {error && <PageState error={error} />}

        {data?.knowledge_stats && (
          <div class="mb-4 text-[12px] text-[var(--color-text-muted)]">
            Wiki: <span class="text-[var(--color-text)]">{data.knowledge_stats.tactics}</span> tactics
            {' · '}<span class="text-[var(--color-text)]">{(data.knowledge_stats.avg_confidence_across_all * 100).toFixed(0)}%</span> avg confidence
            {' · '}<span class="text-[var(--color-text)]">{data.knowledge_stats.categories_with_tactics}/12</span> categories populated
          </div>
        )}

        {!loading && !error && grouped.length === 0 && (
          <PageState
            empty
            emptyTitle="No opportunities yet"
            emptyDescription="Run the research sweep + tactic-add skill to seed the wiki, then opportunities surface here."
          />
        )}

        <div class="space-y-6">
          {grouped.map(({ type, items }) => (
            <section key={type}>
              <h3 class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)] mb-2">
                {TYPE_LABEL[type]} ({items.length})
              </h3>
              <div class="space-y-2">
                {items.map((o) => (
                  <OpportunityCard key={`${o.opportunity_type}:${o.title}`} opportunity={o} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <UnlockedModuleSection page="opportunities" />
        <LockedModuleRail page="opportunities" />
      </div>
    </div>
  );
}

function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  return (
    <div class="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)]">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <div class="text-[14px] font-medium text-[var(--color-text)] truncate">{opportunity.title}</div>
          <div class="text-[12.5px] text-[var(--color-text-muted)] mt-1 leading-relaxed">{opportunity.description}</div>
          <div class="text-[11px] text-[var(--color-text-faint)] mt-1.5 flex items-center gap-2">
            <span>category: <span class="text-[var(--color-text-muted)]">{opportunity.category}</span></span>
            {opportunity.evidence_count !== undefined && (
              <span>· evidence: <span class="text-[var(--color-text-muted)]">{opportunity.evidence_count}</span></span>
            )}
          </div>
        </div>
        <div class="flex-shrink-0 text-right">
          <div class="text-[16px] font-medium tabular-nums text-[var(--color-accent)]">
            {(opportunity.score * 100).toFixed(0)}
          </div>
          <div class="text-[10px] text-[var(--color-text-faint)] uppercase tracking-wide">score</div>
        </div>
      </div>

      {opportunity.supporting_items.length > 0 && (
        <div class="mt-2 pt-2 border-t border-[var(--color-border)]">
          <WhyExpand label="supporting tactics">
            <ul class="space-y-1">
              {opportunity.supporting_items.map((item) => (
                <li key={item} class="text-[12px] font-mono text-[var(--color-text-muted)]">{item}</li>
              ))}
            </ul>
          </WhyExpand>
        </div>
      )}
    </div>
  );
}
