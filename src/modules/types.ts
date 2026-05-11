/**
 * Type contracts for the Universal Module System (Phase 5.0).
 *
 * Every module across every page implements this shape. The registry
 * stores them; the unlock engine evaluates them; the frontend renders them.
 *
 * See gyst-ops/PRP-aiboard-port.md "Universal Diagnostic Dashboard Pattern"
 * for the design rationale.
 */

/** Pages a module can attach to. Must match a frontend page route. */
export type ModulePage =
  | 'pipeline'
  | 'content-performance'
  | 'opportunities'
  | 'configs'
  | 'meta-ads'
  | 'mission'
  | 'hive'
  | 'memories';

/** How a module unlock can happen. */
export type UnlockReason = 'earned' | 'operator';

/**
 * Milestone evaluation result. Returned by a module's `evaluateMilestone()`
 * function. Tells the unlock engine whether the milestone is hit + the
 * client-visible progress (for the locked rail).
 */
export interface MilestoneState {
  /** True when the milestone is satisfied. */
  unlocked: boolean;
  /** 0-100 progress percentage, for the locked rail bar. */
  progress_pct: number;
  /** Human-readable preview text shown in the locked rail.
   *  e.g. "32 of 50 scored leads" or "12 days to go" */
  preview_text: string;
  /** Optional structured progress data (the unlock engine logs this). */
  progress_data?: Record<string, unknown>;
}

/** A function that evaluates whether a module's milestone is hit. */
export type MilestoneEvaluator = (account_id: string) => Promise<MilestoneState> | MilestoneState;

/**
 * Classifier output — per-module data the frontend renders. Each module
 * defines its own shape; the registry stores the function that computes it.
 */
export type ModuleClassifier = (account_id: string) => Promise<unknown> | unknown;

/**
 * The module definition. One of these per module across the system.
 * Registered in `registry.ts` at module load time.
 */
export interface ModuleDef {
  /** Unique kebab-case ID, e.g. "decay-watch". */
  name: string;
  /** Human-readable name, e.g. "Decay Watch". */
  display_name: string;
  /** Which page this module attaches to. */
  page: ModulePage;
  /** One-sentence description shown in the locked rail BEFORE unlock. */
  preview_description: string;
  /** Two-three sentence tour shown ONCE on first appearance after unlock. */
  tour_text: string;
  /** True when this module can ONLY be unlocked by operator override (no earnable milestone). */
  operator_gated_only?: boolean;
  /** Function that evaluates the unlock milestone. Required unless operator_gated_only. */
  evaluateMilestone?: MilestoneEvaluator;
  /** Function that computes the classifier output (rendered by the frontend module UI). */
  classifier?: ModuleClassifier;
}

/**
 * Persisted unlock state row from the DB. Returned by the API to the frontend
 * for rendering the locked-rail + module sections.
 */
export interface ModuleStateRow {
  module_name: string;
  display_name: string;
  page: ModulePage;
  preview_description: string;
  tour_text: string;
  unlocked: boolean;
  unlocked_at: number | null;
  unlocked_by: UnlockReason | null;
  /** Progress 0-100 for locked modules. 100 for unlocked. */
  progress_pct: number;
  /** Preview text shown in the locked rail. */
  preview_text: string;
  /** Has the user dismissed the first-appearance tour for this module? */
  tour_seen: boolean;
}

/** Action log entry — used by Impact Tracker module + cross-page unlock criteria. */
export interface ActionLogEntry {
  account_id: string;
  page: ModulePage;
  /** What did the dashboard suggest? e.g. 'scale_ad', 'kill_campaign', 'ship_post' */
  action_type: string;
  /** The target — ad_id, campaign_id, post_id, etc. */
  action_target: string;
  /** When the dashboard surfaced the verdict (now if not specified). */
  suggested_at?: number;
  /** When the user took action (null if logging suggestion only). */
  taken_at?: number;
  /** Optional outcome data (revenue, engagement delta, etc). */
  outcome_json?: Record<string, unknown>;
}
