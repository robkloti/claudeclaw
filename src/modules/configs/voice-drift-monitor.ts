/**
 * Voice Drift Monitor module — configs page, Phase 5.3.
 *
 * Operator-gated only. Surfaces when voice.md hasn't been touched in
 * 30+ days while feedback-synth has been adding deltas at the bottom.
 * Suggests promoting unaccepted deltas to actual rules.
 *
 * Why operator-gated: requires judgment about whether the client is
 * actively maintaining their voice or letting it drift.
 */

import { ModuleDef } from '../types.js';
import fs from 'fs';
import path from 'path';
import { readEnvFile } from '../../env.js';

function gystOpsPath(): string {
  const env = readEnvFile(['GYST_OPS_PATH']);
  return env.GYST_OPS_PATH || path.join(process.env.HOME || '/Users/robkloti', 'projects', 'gyst-ops');
}

const voiceDriftMonitor: ModuleDef = {
  name: 'voice-drift-monitor',
  display_name: 'Voice Drift Monitor',
  page: 'configs',
  preview_description: 'Detects voice.md staleness vs accumulated synth deltas. Surfaces unpromoted action items.',
  tour_text: 'Synth deltas pile up at the bottom of voice.md until you promote them to actual rules. Voice Drift Monitor flags when too much sediment has accumulated unaddressed.',
  operator_gated_only: true,

  classifier: (): unknown => {
    const file = path.join(gystOpsPath(), 'references', 'voice.md');
    if (!fs.existsSync(file)) return { found: false, reason: 'voice.md not found' };
    const stat = fs.statSync(file);
    const ageDays = Math.floor((Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24));
    const text = fs.readFileSync(file, 'utf-8');
    // Count "## Synth Delta" sections (appended by feedback-synth)
    const deltaCount = (text.match(/^## Synth Delta/gm) || []).length;
    // Count `- [ ]` checkboxes in synth delta sections (proxy for unpromoted action items)
    const lastDelta = text.split(/^## Synth Delta/m).pop() || '';
    const unpromoted = (lastDelta.match(/\n- \[ \]/g) || []).length;
    return {
      voice_age_days: ageDays,
      synth_delta_count: deltaCount,
      unpromoted_action_items: unpromoted,
      drift_level: deltaCount > 3 && ageDays > 30 ? 'high' : (unpromoted > 0 ? 'medium' : 'low'),
      recommendation: unpromoted > 0
        ? `Review the latest Synth Delta section — ${unpromoted} action item(s) await promotion to actual rules.`
        : 'Voice doc is current — nothing to promote.',
    };
  },
};

export default voiceDriftMonitor;
