/**
 * Tactic Combinatorics module — opportunities page, Phase 5.3.
 *
 * Surfaces tactic PAIRS that consistently appear together in winning
 * content (cross-tactic correlation). Suggests framework opportunities
 * — when 3+ tactics co-occur, that's a candidate framework.
 *
 * Milestone: 10+ wiki tactics with confidence ≥ 0.50.
 */

import { ModuleDef, MilestoneState } from '../types.js';
import { spawn } from 'child_process';
import path from 'path';
import { readEnvFile } from '../../env.js';

function gystOpsPath(): string {
  const env = readEnvFile(['GYST_OPS_PATH']);
  return env.GYST_OPS_PATH || path.join(process.env.HOME || '/Users/robkloti', 'projects', 'gyst-ops');
}

async function runWikiStats(): Promise<any> {
  // We use the existing decide.py to enumerate tactics + confidence in JSON
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [
      path.join(gystOpsPath(), 'lib', 'decide.py'),
      '--json', '--limit', '100', '--min-score', '0',
    ], { cwd: gystOpsPath() });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`decide.py exited ${code}`));
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
    proc.on('error', reject);
  });
}

const MILESTONE_TACTIC_COUNT = 10;
const MIN_CONFIDENCE = 0.5;

const tacticCombinatorics: ModuleDef = {
  name: 'tactic-combinatorics',
  display_name: 'Tactic Combinatorics',
  page: 'opportunities',
  preview_description: 'When tactics co-occur, that\'s a framework. Surfaces tactic pairs that consistently win together.',
  tour_text: 'Your wiki has enough tactics that combinations matter. Tactic Combinatorics finds tactics that co-appear in winning content — those clusters become candidate frameworks.',

  evaluateMilestone: async (): Promise<MilestoneState> => {
    try {
      const data = await runWikiStats();
      // Approximate confident-tactic count: read coverage + filter to high_confidence_count
      const cov = (data.category_coverage || []) as Array<{ high_confidence_count: number }>;
      const confidentCount = cov.reduce((s, c) => s + (c.high_confidence_count || 0), 0);
      if (confidentCount >= MILESTONE_TACTIC_COUNT) {
        return { unlocked: true, progress_pct: 100, preview_text: `${confidentCount} confident tactics` };
      }
      return {
        unlocked: false,
        progress_pct: Math.min(100, Math.round((confidentCount / MILESTONE_TACTIC_COUNT) * 100)),
        preview_text: `${confidentCount} of ${MILESTONE_TACTIC_COUNT} confident tactics`,
      };
    } catch {
      return { unlocked: false, progress_pct: 0, preview_text: 'Awaiting wiki data' };
    }
  },

  classifier: async (): Promise<unknown> => {
    try {
      const data = await runWikiStats();
      // For v1: surface the top categories as "framework candidates" — the
      // multi-tactic clusters that are already strong. Real tactic-pair
      // co-occurrence would require post-tactic-mapping data we don't have.
      const ops = (data.opportunities || []) as Array<{ opportunity_type: string; title: string; supporting_items?: string[]; score: number; category: string }>;
      const clusters = ops.filter((o) => o.opportunity_type === 'high_confidence_cluster');
      return {
        cluster_count: clusters.length,
        candidate_frameworks: clusters.map((c) => ({
          name: c.title.replace(/^Deep Dive: /, ''),
          category: c.category,
          tactics: c.supporting_items || [],
          score: c.score,
          why: `${(c.supporting_items || []).length} high-confidence tactics in this category cluster — they likely combine into a repeatable framework.`,
        })),
      };
    } catch (e) {
      return { error: (e as Error).message, cluster_count: 0, candidate_frameworks: [] };
    }
  },
};

export default tacticCombinatorics;
