/**
 * Impact Tracker module — meta-ads page, Phase 5.2.
 *
 * Logs every suggested action and measures realized impact. Running tally
 * of what the dashboard earned the client.
 *
 * Milestone (earned): client has acted on 3+ verdicts logged via
 * /api/actions/log on the meta-ads page.
 *
 * Output: total actions suggested, total taken, realized $ impact (sum of
 * outcome_json.revenue_delta where present).
 */

import { ModuleDef, MilestoneState } from '../types.js';
import { recentActions } from '../unlock-engine.js';

const IMPACT_PAGE = 'meta-ads';
const IMPACT_LOOKBACK_SECONDS = 30 * 24 * 60 * 60; // 30 days

const impactTracker: ModuleDef = {
  name: 'impact-tracker',
  display_name: 'Impact Tracker',
  page: 'meta-ads',
  preview_description: 'Log every suggested action, measure realized impact. Running tally of dashboard ROI.',
  tour_text: 'Now that you\'ve acted on a few verdicts, Impact Tracker shows what those decisions earned you. The dashboard\'s suggestions become measurable ROI.',

  evaluateMilestone: (account_id: string): MilestoneState => {
    const since = Math.floor(Date.now() / 1000) - IMPACT_LOOKBACK_SECONDS;
    const actions = recentActions(account_id, IMPACT_PAGE, since);
    const taken = actions.filter((a) => a.taken_at !== null).length;
    if (taken >= 3) {
      return {
        unlocked: true,
        progress_pct: 100,
        preview_text: `${taken} actions taken`,
        progress_data: { taken_count: taken },
      };
    }
    return {
      unlocked: false,
      progress_pct: Math.min(100, Math.round((taken / 3) * 100)),
      preview_text: `${taken} of 3 actions taken`,
      progress_data: { taken_count: taken },
    };
  },

  classifier: (account_id: string): unknown => {
    const since = Math.floor(Date.now() / 1000) - IMPACT_LOOKBACK_SECONDS;
    const actions = recentActions(account_id, IMPACT_PAGE, since);
    const suggested = actions.length;
    const taken = actions.filter((a) => a.taken_at !== null).length;
    let realized_revenue_delta = 0;
    let measured_actions = 0;
    for (const a of actions) {
      if (!a.taken_at) continue;
      try {
        const outcome = JSON.parse(a.outcome_json || '{}');
        if (typeof outcome.revenue_delta === 'number') {
          realized_revenue_delta += outcome.revenue_delta;
          measured_actions += 1;
        }
      } catch { /* ignore parse errors */ }
    }
    return {
      window_days: 30,
      suggested,
      taken,
      pending: suggested - taken,
      realized_revenue_delta: Math.round(realized_revenue_delta * 100) / 100,
      measured_actions,
      take_rate: suggested > 0 ? Math.round((taken / suggested) * 100) : 0,
    };
  },
};

export default impactTracker;
