/**
 * Decay Watch module — meta-ads page, Phase 5.2.
 *
 * Catches ads bleeding money on surface metrics. Adds two patterns the
 * base classifier doesn't surface:
 *   - Decaying Winner: was a Proven Machine, CTR slipping vs its own
 *                      historical baseline
 *   - Volume Trap:     high spend on declining engagement (CPM up, CTR down)
 *
 * Milestone (earned): 30 days of active spend on the account OR at least
 * one ad classified as Proven Machine for 14+ consecutive days.
 *
 * For v1 we use a SIMPLE proxy:
 *   - "30 days of spend" = at least one ad with days_active >= 30 in the
 *     classifier output
 *   - "1 Proven Machine for 14d" = at least one Proven Machine pattern
 *     with days_active >= 14
 */

import { ModuleDef, MilestoneState } from '../types.js';
import { spawn } from 'child_process';
import path from 'path';
import { readEnvFile } from '../../env.js';

function gystOpsPath(): string {
  const env = readEnvFile(['GYST_OPS_PATH']);
  return env.GYST_OPS_PATH || path.join(process.env.HOME || '/Users/robkloti', 'projects', 'gyst-ops');
}

/** Run the classifier (cached) and return its parsed output. */
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

const decayWatch: ModuleDef = {
  name: 'decay-watch',
  display_name: 'Decay Watch',
  page: 'meta-ads',
  preview_description: 'Catches ads bleeding money on surface metrics. Surfaces Decaying Winners + Volume Traps.',
  tour_text: 'Once your ads have run for a while, the base patterns miss decay — winners that are slipping. Decay Watch flags them before they burn another week of budget.',

  evaluateMilestone: async (): Promise<MilestoneState> => {
    try {
      const data = await runClassifier();
      const ads = (data.ads || []) as Array<{ days_active: number; pattern: string }>;
      const oldestDays = ads.length ? Math.max(...ads.map((a) => a.days_active || 0)) : 0;
      const provenMachineLong = ads.find((a) => a.pattern === 'Proven Machine' && a.days_active >= 14);

      if (oldestDays >= 30 || provenMachineLong) {
        return {
          unlocked: true,
          progress_pct: 100,
          preview_text: provenMachineLong ? 'Proven Machine 14d+' : `${oldestDays}d of spend`,
          progress_data: { oldest_days: oldestDays, has_proven_machine_14d: !!provenMachineLong },
        };
      }

      // Progress = max(days/30, days_in_proven_machine/14) — whichever is closer to 100%
      const maxDaysProgress = Math.min(100, (oldestDays / 30) * 100);
      const provenMachineMax = ads
        .filter((a) => a.pattern === 'Proven Machine')
        .reduce((m, a) => Math.max(m, a.days_active), 0);
      const provenProgress = Math.min(100, (provenMachineMax / 14) * 100);
      const pct = Math.round(Math.max(maxDaysProgress, provenProgress));

      const preview = oldestDays > 0
        ? `${oldestDays} of 30 days`
        : 'Waiting for first active ad';

      return {
        unlocked: false,
        progress_pct: pct,
        preview_text: preview,
        progress_data: { oldest_days: oldestDays, proven_machine_max_days: provenMachineMax },
      };
    } catch {
      return { unlocked: false, progress_pct: 0, preview_text: 'Awaiting first ad data' };
    }
  },

  classifier: async (): Promise<unknown> => {
    try {
      const data = await runClassifier();
      const ads = (data.ads || []) as Array<{
        ad_id: string; name: string; pattern: string; days_active: number;
        metrics: { ctr: number; ctr_ratio_vs_median: number; spend: number; daily_spend: number; cpm: number };
      }>;

      // Decaying Winner: pattern == "Proven Machine" but ctr_ratio_vs_median dropped
      // (we'd need historical CTR to be precise; for v1 flag any Proven Machine with
      //  ctr_ratio_vs_median between 1.0-1.2 — barely above median, sliding)
      const decayingWinners = ads.filter((a) =>
        a.pattern === 'Proven Machine'
        && a.metrics.ctr_ratio_vs_median < 1.2
        && a.metrics.ctr_ratio_vs_median >= 1.0,
      );

      // Volume Trap: spending heavily but CTR ratio unhealthy and CPM elevated
      const volumeTraps = ads.filter((a) =>
        a.metrics.daily_spend >= 30
        && a.metrics.ctr_ratio_vs_median < 0.9
        && a.metrics.cpm > 0,
      );

      return {
        decaying_winners: decayingWinners.map((a) => ({
          ad_id: a.ad_id,
          name: a.name,
          ctr_ratio: a.metrics.ctr_ratio_vs_median,
          daily_spend: a.metrics.daily_spend,
          why: `Pattern was Proven Machine but CTR ratio dropped to ${a.metrics.ctr_ratio_vs_median.toFixed(2)}x median. Sliding toward average.`,
        })),
        volume_traps: volumeTraps.map((a) => ({
          ad_id: a.ad_id,
          name: a.name,
          ctr_ratio: a.metrics.ctr_ratio_vs_median,
          daily_spend: a.metrics.daily_spend,
          cpm: a.metrics.cpm,
          why: `Spending $${a.metrics.daily_spend.toFixed(2)}/d with CTR ${a.metrics.ctr_ratio_vs_median.toFixed(2)}x median and CPM $${a.metrics.cpm.toFixed(2)}. High spend on weak engagement.`,
        })),
        total_flagged: decayingWinners.length + volumeTraps.length,
      };
    } catch (e) {
      return { error: `Decay Watch classifier failed: ${(e as Error).message}`, decaying_winners: [], volume_traps: [], total_flagged: 0 };
    }
  },
};

export default decayWatch;
