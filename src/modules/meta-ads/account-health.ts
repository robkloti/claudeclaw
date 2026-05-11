/**
 * Account Health module — meta-ads page, Phase 5.3.
 *
 * Account-wide trend signals: CPM drift, audience saturation flags,
 * creative fatigue across the board.
 *
 * Milestone: $5K+ cumulative spend on the account (account-level trends
 * need volume to be meaningful).
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

const MILESTONE_SPEND = 5000;

const accountHealth: ModuleDef = {
  name: 'account-health',
  display_name: 'Account Health',
  page: 'meta-ads',
  preview_description: 'Account-wide CPM drift, saturation flags, creative fatigue. Trends need volume to be meaningful.',
  tour_text: 'You\'ve put enough through the account that account-level trends are now meaningful. Account Health surfaces CPM drift, fatigue indicators, and saturation warnings.',

  evaluateMilestone: async (): Promise<MilestoneState> => {
    try {
      const data = await runClassifier();
      const totalSpend = (data.ads || []).reduce((s: number, a: any) => s + (a.metrics?.spend || 0), 0);
      if (totalSpend >= MILESTONE_SPEND) {
        return { unlocked: true, progress_pct: 100, preview_text: `$${totalSpend.toFixed(0)} cumulative spend` };
      }
      return {
        unlocked: false,
        progress_pct: Math.min(100, Math.round((totalSpend / MILESTONE_SPEND) * 100)),
        preview_text: `$${totalSpend.toFixed(0)} of $${MILESTONE_SPEND.toLocaleString()} spend`,
      };
    } catch {
      return { unlocked: false, progress_pct: 0, preview_text: 'Awaiting first ad data' };
    }
  },

  classifier: async (): Promise<unknown> => {
    try {
      const data = await runClassifier();
      const ads = (data.ads || []) as Array<{ metrics: { cpm: number; ctr: number; spend: number; daily_spend: number; ctr_ratio_vs_median: number } }>;
      if (!ads.length) return { health: 'unknown', signals: [] };

      const totalSpend = ads.reduce((s, a) => s + a.metrics.spend, 0);
      const totalDaily = ads.reduce((s, a) => s + a.metrics.daily_spend, 0);
      const cpms = ads.map((a) => a.metrics.cpm).filter((c) => c > 0);
      const avgCpm = cpms.length ? cpms.reduce((s, c) => s + c, 0) / cpms.length : 0;
      const ctrs = ads.map((a) => a.metrics.ctr).filter((c) => c > 0);
      const avgCtr = ctrs.length ? ctrs.reduce((s, c) => s + c, 0) / ctrs.length : 0;
      const lowRatioCount = ads.filter((a) => a.metrics.ctr_ratio_vs_median < 0.7).length;
      const fatigueRate = ads.length ? lowRatioCount / ads.length : 0;

      const signals: Array<{ severity: 'ok' | 'warn' | 'critical'; signal: string; detail: string }> = [];

      if (avgCpm > 30) {
        signals.push({ severity: 'warn', signal: 'High CPM', detail: `Account-wide CPM averaging $${avgCpm.toFixed(2)} — consider broadening audiences or refreshing creatives.` });
      } else if (avgCpm > 0) {
        signals.push({ severity: 'ok', signal: 'CPM stable', detail: `$${avgCpm.toFixed(2)} avg.` });
      }

      if (fatigueRate > 0.4) {
        signals.push({ severity: 'critical', signal: 'Creative fatigue', detail: `${Math.round(fatigueRate * 100)}% of ads scoring below 0.7x median CTR. Refresh creatives.` });
      } else if (fatigueRate > 0.2) {
        signals.push({ severity: 'warn', signal: 'Some fatigue showing', detail: `${Math.round(fatigueRate * 100)}% of ads underperforming.` });
      }

      if (totalDaily > 200) {
        signals.push({ severity: 'ok', signal: 'Healthy daily volume', detail: `$${totalDaily.toFixed(0)}/day across active set.` });
      }

      const overall = signals.some((s) => s.severity === 'critical')
        ? 'critical'
        : signals.some((s) => s.severity === 'warn') ? 'warn' : 'ok';

      return {
        health: overall,
        cumulative_spend: Math.round(totalSpend * 100) / 100,
        daily_run_rate: Math.round(totalDaily * 100) / 100,
        avg_cpm: Math.round(avgCpm * 100) / 100,
        avg_ctr: Math.round(avgCtr * 100) / 100,
        active_ad_count: ads.length,
        signals,
      };
    } catch (e) {
      return { error: (e as Error).message, health: 'unknown', signals: [] };
    }
  },
};

export default accountHealth;
