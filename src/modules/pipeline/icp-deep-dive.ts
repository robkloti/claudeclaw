/**
 * ICP Scoring Deep Dive module — pipeline page, Phase 5.2.
 *
 * Score distribution chart + below-threshold reasons breakdown.
 *
 * Milestone (earned): 50+ scored leads in `outreach/data/scored/`.
 * Output: bucketed score distribution + top reasons leads scored low.
 */

import { ModuleDef, MilestoneState } from '../types.js';
import fs from 'fs';
import path from 'path';
import { readEnvFile } from '../../env.js';

function gystOpsPath(): string {
  const env = readEnvFile(['GYST_OPS_PATH']);
  return env.GYST_OPS_PATH || path.join(process.env.HOME || '/Users/robkloti', 'projects', 'gyst-ops');
}

/** Read all CSVs in outreach/data/scored/ — each row = a scored lead. */
function readAllScoredLeads(): Array<{ score: number; reason: string }> {
  const dir = path.join(gystOpsPath(), 'outreach', 'data', 'scored');
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ score: number; reason: string }> = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.csv')) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf-8');
    const lines = text.trim().split('\n');
    if (lines.length < 2) continue;
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const scoreIdx = header.findIndex((h) => h === 'score' || h === 'icp_score');
    const reasonIdx = header.findIndex((h) => h === 'reason' || h === 'why' || h === 'notes');
    if (scoreIdx === -1) continue;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const score = parseFloat(cols[scoreIdx]);
      if (isNaN(score)) continue;
      const reason = reasonIdx !== -1 ? (cols[reasonIdx] || '').trim() : '';
      out.push({ score, reason });
    }
  }
  return out;
}

const icpDeepDive: ModuleDef = {
  name: 'icp-deep-dive',
  display_name: 'ICP Scoring Deep Dive',
  page: 'pipeline',
  preview_description: 'Score distribution + below-threshold reasons. See exactly why your leads cluster where they do.',
  tour_text: 'You have enough scored leads now to see the shape of your funnel. ICP Deep Dive surfaces the score distribution and the most common reasons leads underscore.',

  evaluateMilestone: (): MilestoneState => {
    const leads = readAllScoredLeads();
    const count = leads.length;
    if (count >= 50) {
      return {
        unlocked: true,
        progress_pct: 100,
        preview_text: `${count} scored leads`,
        progress_data: { lead_count: count },
      };
    }
    return {
      unlocked: false,
      progress_pct: Math.min(100, Math.round((count / 50) * 100)),
      preview_text: `${count} of 50 scored leads`,
      progress_data: { lead_count: count },
    };
  },

  classifier: (): unknown => {
    const leads = readAllScoredLeads();
    if (!leads.length) return { lead_count: 0, distribution: [], top_reasons: [] };

    // Bucket scores into 11 bins (0-10)
    const buckets = Array.from({ length: 11 }, (_, i) => ({ score: i, count: 0 }));
    for (const l of leads) {
      const idx = Math.max(0, Math.min(10, Math.round(l.score)));
      buckets[idx].count += 1;
    }

    // Top reasons among low-scoring leads (score <= 5)
    const lowReasons: Record<string, number> = {};
    for (const l of leads) {
      if (l.score > 5 || !l.reason) continue;
      const key = l.reason.toLowerCase().slice(0, 80);
      lowReasons[key] = (lowReasons[key] || 0) + 1;
    }
    const top_reasons = Object.entries(lowReasons)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    return {
      lead_count: leads.length,
      avg_score: Math.round((leads.reduce((s, l) => s + l.score, 0) / leads.length) * 100) / 100,
      median_score: leads.map((l) => l.score).sort((a, b) => a - b)[Math.floor(leads.length / 2)],
      distribution: buckets,
      top_reasons,
    };
  },
};

export default icpDeepDive;
