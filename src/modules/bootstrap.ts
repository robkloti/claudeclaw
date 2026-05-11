/**
 * Module bootstrap — Phase 5.2 + 5.3.
 *
 * Imports every module file and registers it via the registry. Called ONCE
 * at daemon startup from src/index.ts. New modules ship by adding their
 * file to the per-page directory and importing here.
 */

import { registerModule } from './registry.js';

// Meta Ads modules
import decayWatch from './meta-ads/decay-watch.js';
import impactTracker from './meta-ads/impact-tracker.js';
import creativeIntelligence from './meta-ads/creative-intelligence.js';
import accountHealth from './meta-ads/account-health.js';
import falseNegativeGuard from './meta-ads/false-negative-guard.js';

// Pipeline modules
import icpDeepDive from './pipeline/icp-deep-dive.js';
import sourceAttribution from './pipeline/source-attribution.js';

// Content Performance modules
import hookIntelligence from './content-performance/hook-intelligence.js';
import crossPlatformPerformance from './content-performance/cross-platform-performance.js';

// Opportunities modules
import tacticCombinatorics from './opportunities/tactic-combinatorics.js';
import coverageGapIntelligence from './opportunities/coverage-gap-intelligence.js';

// Configs modules
import voiceDriftMonitor from './configs/voice-drift-monitor.js';

let _bootstrapped = false;

export function bootstrapModules(): void {
  if (_bootstrapped) return;
  _bootstrapped = true;

  // Phase 5.2 modules
  registerModule(decayWatch);
  registerModule(impactTracker);
  registerModule(icpDeepDive);
  registerModule(hookIntelligence);

  // Phase 5.3 modules
  registerModule(creativeIntelligence);
  registerModule(accountHealth);
  registerModule(falseNegativeGuard);
  registerModule(sourceAttribution);
  registerModule(crossPlatformPerformance);
  registerModule(tacticCombinatorics);
  registerModule(coverageGapIntelligence);
  registerModule(voiceDriftMonitor);
}
