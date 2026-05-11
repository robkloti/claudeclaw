/**
 * Creative Intelligence module — meta-ads page, Phase 5.3.
 *
 * Cross-ad pattern detection. Surfaces which creative angle is the real
 * winner across multiple ads (vs which ones happened to be lucky).
 *
 * Milestone: 5+ active ads on the account (cross-ad patterns need data).
 */

import { ModuleDef, MilestoneState } from '../types.js';
import { spawn } from 'child_process';
import path from 'path';
import { readEnvFile } from '../../env.js';

function gystOpsPath(): string {
  const env = readEnvFile(['GYST_OPS_PATH']);
  return env.GYST_OPS_PATH || path.join(process.env.HOME || '/Users/robkloti', 'projects', 'gyst-ops');
}

async function runClassifier(): Promise<any> {
  const classifierPath = path.join(gystOpsPath(), 'ads', 'diagnostic', 'classifier.py');
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [classifierPath], { cwd: gystOpsPath() });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`classifier exited ${code}`));
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
    proc.on('error', reject);
  });
}

/** Crude angle extraction from ad name — splits on common separators. */
function extractAngle(name: string): string {
  const parts = name.split(/\s*[-—|:]\s*/);
  // Use first 2-3 words after any leading "test" / "v1" / numbers
  const cleaned = parts[0].replace(/^(test|v\d+|\d+)\s+/i, '').trim();
  return cleaned.split(/\s+/).slice(0, 3).join(' ').toLowerCase() || 'untitled';
}

const creativeIntelligence: ModuleDef = {
  name: 'creative-intelligence',
  display_name: 'Creative Intelligence',
  page: 'meta-ads',
  preview_description: 'Cross-ad pattern detection. Which creative angle is the real winner across your ads?',
  tour_text: 'With 5+ active ads, patterns emerge. Creative Intelligence groups your ads by angle (extracted from naming) and ranks angles by avg CTR — finding the winner across noise.',

  evaluateMilestone: async (): Promise<MilestoneState> => {
    try {
      const data = await runClassifier();
      const ads = (data.ads || []) as any[];
      const count = ads.length;
      if (count >= 5) {
        return { unlocked: true, progress_pct: 100, preview_text: `${count} active ads` };
      }
      return {
        unlocked: false,
        progress_pct: Math.min(100, Math.round((count / 5) * 100)),
        preview_text: `${count} of 5 active ads`,
      };
    } catch {
      return { unlocked: false, progress_pct: 0, preview_text: 'Awaiting first active ad' };
    }
  },

  classifier: async (): Promise<unknown> => {
    try {
      const data = await runClassifier();
      const ads = (data.ads || []) as Array<{ name: string; metrics: { ctr: number; spend: number; ctr_ratio_vs_median: number } }>;
      const byAngle: Record<string, { count: number; total_ctr: number; total_spend: number; ratios: number[] }> = {};
      for (const ad of ads) {
        const angle = extractAngle(ad.name);
        const b = byAngle[angle] || { count: 0, total_ctr: 0, total_spend: 0, ratios: [] };
        b.count += 1;
        b.total_ctr += ad.metrics.ctr;
        b.total_spend += ad.metrics.spend;
        b.ratios.push(ad.metrics.ctr_ratio_vs_median);
        byAngle[angle] = b;
      }
      const ranked = Object.entries(byAngle)
        .filter(([, b]) => b.count >= 1)
        .map(([angle, b]) => ({
          angle,
          ad_count: b.count,
          avg_ctr: Math.round((b.total_ctr / b.count) * 100) / 100,
          avg_ratio: Math.round((b.ratios.reduce((s, r) => s + r, 0) / b.ratios.length) * 100) / 100,
          total_spend: Math.round(b.total_spend * 100) / 100,
        }))
        .sort((a, b) => b.avg_ratio - a.avg_ratio);
      return { angle_count: ranked.length, top_angles: ranked.slice(0, 5), bottom_angles: ranked.slice(-3).reverse() };
    } catch (e) {
      return { error: (e as Error).message, angle_count: 0, top_angles: [], bottom_angles: [] };
    }
  },
};

export default creativeIntelligence;
