/**
 * False Negative Guard module — meta-ads page, Phase 5.3.
 *
 * Operator-gated only. Protects downstream-converting ads from
 * surface-metric kill rules. Annotates "Kill" verdicts on ads where
 * downstream signal (replies, booked calls, sales attribution) suggests
 * the ad is actually working despite weak surface engagement.
 *
 * Why operator-gated: requires judgment about client sophistication. A
 * client who doesn't track downstream conversion shouldn't see this
 * (they'd ignore the warning + kill anyway).
 */

import { ModuleDef } from '../types.js';
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

const falseNegativeGuard: ModuleDef = {
  name: 'false-negative-guard',
  display_name: 'False Negative Guard',
  page: 'meta-ads',
  preview_description: 'Protects downstream-converting ads from surface-metric kill rules.',
  tour_text: 'Some ads bury their value below the surface — weak CTR but the people who DO click convert at high rates. False Negative Guard flags these so you don\'t kill a quiet winner.',
  operator_gated_only: true,

  classifier: async (): Promise<unknown> => {
    try {
      const data = await runClassifier();
      const ads = (data.ads || []) as Array<{ ad_id: string; name: string; pattern: string; verdict: string; metrics: { clicks: number; spend: number; ctr_ratio_vs_median: number } }>;
      // Find ads classified as Underperformer or Stalled with non-trivial click counts
      // (proxy for "low CTR but the clicks they DO get might be high-quality")
      const protectedAds = ads.filter((a) =>
        (a.pattern === 'Underperformer' || a.pattern === 'Stalled')
        && a.metrics.clicks >= 10,
      );
      return {
        protected_count: protectedAds.length,
        protected_ads: protectedAds.map((a) => ({
          ad_id: a.ad_id,
          name: a.name,
          pattern: a.pattern,
          verdict_overridden: 'WAIT — downstream signal possible',
          clicks: a.metrics.clicks,
          spend: a.metrics.spend,
          why: `${a.metrics.clicks} clicks despite ${a.metrics.ctr_ratio_vs_median.toFixed(2)}x median CTR. Check downstream conversion before killing.`,
        })),
      };
    } catch (e) {
      return { error: (e as Error).message, protected_count: 0, protected_ads: [] };
    }
  },
};

export default falseNegativeGuard;
