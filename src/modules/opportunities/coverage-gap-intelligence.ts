/**
 * Coverage Gap Intelligence module — opportunities page, Phase 5.3.
 *
 * For each known wiki coverage gap (category with low/no tactics), suggests
 * which active research source(s) are most likely to fill it. Connects the
 * research ingestion pipeline to the wiki gaps so research effort is targeted.
 *
 * Milestone: 3+ active source feeds in research/sources/.
 */

import { ModuleDef, MilestoneState } from '../types.js';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { readEnvFile } from '../../env.js';

function gystOpsPath(): string {
  const env = readEnvFile(['GYST_OPS_PATH']);
  return env.GYST_OPS_PATH || path.join(process.env.HOME || '/Users/robkloti', 'projects', 'gyst-ops');
}

const SOURCE_FILES = ['articles.json', 'twitter.json', 'youtube.json', 'github.json', 'instagram.json'];

function countActiveSources(): { total: number; per_type: Record<string, number> } {
  const dir = path.join(gystOpsPath(), 'research', 'sources');
  let total = 0;
  const per_type: Record<string, number> = {};
  for (const f of SOURCE_FILES) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    try {
      const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const active = arr.filter((s: any) => s.active !== false).length;
      per_type[f.replace('.json', '')] = active;
      total += active;
    } catch { /* ignore */ }
  }
  return { total, per_type };
}

async function runDecide(): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [
      path.join(gystOpsPath(), 'lib', 'decide.py'),
      '--json', '--limit', '50', '--min-score', '0',
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

const coverageGapIntelligence: ModuleDef = {
  name: 'coverage-gap-intelligence',
  display_name: 'Coverage Gap Intelligence',
  page: 'opportunities',
  preview_description: 'Connects wiki gaps to your active research sources. Tells you which feeds to mine for what.',
  tour_text: 'Now that you have multiple active research sources, Coverage Gap Intelligence maps your known wiki gaps to the sources most likely to fill them.',

  evaluateMilestone: (): MilestoneState => {
    const { total } = countActiveSources();
    if (total >= 3) {
      return { unlocked: true, progress_pct: 100, preview_text: `${total} active sources` };
    }
    return {
      unlocked: false,
      progress_pct: Math.min(100, Math.round((total / 3) * 100)),
      preview_text: `${total} of 3 active sources`,
    };
  },

  classifier: async (): Promise<unknown> => {
    try {
      const { total, per_type } = countActiveSources();
      const data = await runDecide();
      const gaps = (data.opportunities || []).filter((o: any) => o.opportunity_type === 'coverage_gap');
      // Heuristic mapping: which source TYPES are best for which categories
      const mapping: Record<string, string[]> = {
        hooks: ['twitter', 'youtube'],
        storytelling: ['articles', 'youtube'],
        copywriting: ['articles', 'twitter'],
        email: ['articles'],
        cta: ['twitter', 'articles'],
        thumbnails: ['youtube', 'instagram'],
        titles: ['youtube', 'articles'],
        retention: ['youtube'],
        conversion: ['articles', 'twitter'],
        audience: ['twitter', 'instagram'],
        distribution: ['articles'],
        brand_voice: ['twitter', 'youtube'],
      };
      const enriched = gaps.map((g: any) => {
        const recommended = (mapping[g.category] || []).filter((src: string) => (per_type[src] || 0) > 0);
        return {
          category: g.category,
          gap_score: g.score,
          recommended_sources: recommended,
          active_in_those_sources: recommended.reduce((s: number, src: string) => s + (per_type[src] || 0), 0),
          why: recommended.length
            ? `Mine your ${recommended.join(' + ')} sources for ${g.category} tactics — that's where they typically appear.`
            : `Add ${(mapping[g.category] || []).join('/')} sources to start covering ${g.category}.`,
        };
      });
      return { active_source_count: total, per_type, gap_count: gaps.length, gaps_with_sources: enriched };
    } catch (e) {
      return { error: (e as Error).message };
    }
  },
};

export default coverageGapIntelligence;
