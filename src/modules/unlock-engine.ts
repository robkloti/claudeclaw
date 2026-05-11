/**
 * Unlock engine — Phase 5.0.
 *
 * Walks every account × every module nightly + on action events.
 * Persists state to claudeclaw.db:module_unlock_state.
 *
 * Operator override always wins: an entry with unlocked_by='operator'
 * is never overridden by milestone evaluation, even if the milestone fails.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../config.js';
import { listModules, getModule } from './registry.js';
import type { ModulePage, ModuleStateRow, MilestoneState, UnlockReason } from './types.js';

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (!_db) {
    _db = new Database(path.join(STORE_DIR, 'claudeclaw.db'));
    _db.pragma('journal_mode = WAL');
  }
  return _db;
}

const DEFAULT_ACCOUNT = 'default';

/**
 * Evaluate ONE module's milestone for one account and persist the result.
 * Returns the final state row.
 *
 * - If the module is operator_gated_only OR has been operator-unlocked already,
 *   the milestone is NOT re-evaluated (operator override wins).
 * - If the milestone is hit, marks unlocked + records unlocked_by='earned'.
 * - If not hit, records progress for the locked rail.
 */
export async function evaluateModule(
  module_name: string,
  account_id: string = DEFAULT_ACCOUNT,
): Promise<ModuleStateRow | null> {
  const def = getModule(module_name);
  if (!def) return null;

  const conn = db();
  const existing = conn.prepare(
    'SELECT unlocked_at, unlocked_by, milestone_progress_json FROM module_unlock_state WHERE account_id = ? AND module_name = ?',
  ).get(account_id, module_name) as
    | { unlocked_at: number | null; unlocked_by: string | null; milestone_progress_json: string }
    | undefined;

  // Operator override wins — never re-evaluate or downgrade
  if (existing?.unlocked_by === 'operator' && existing?.unlocked_at) {
    return buildStateRow(def, account_id, true, existing.unlocked_at, 'operator', 100, 'unlocked by operator');
  }

  // Operator-gated-only modules without operator unlock → stay locked, no progress
  if (def.operator_gated_only) {
    upsertState(account_id, module_name, def.page, null, null, '{}');
    return buildStateRow(def, account_id, false, null, null, 0, 'operator-gated only');
  }

  // Evaluate milestone
  let milestone: MilestoneState;
  try {
    milestone = await Promise.resolve(def.evaluateMilestone!(account_id));
  } catch (err) {
    console.warn(`unlock-engine: ${module_name} evaluation failed:`, err);
    return buildStateRow(def, account_id, false, null, null, 0, 'evaluation error');
  }

  if (milestone.unlocked) {
    // Newly unlocked? Set unlocked_at if not already set
    const unlocked_at = existing?.unlocked_at ?? Math.floor(Date.now() / 1000);
    const unlocked_by: UnlockReason = 'earned';
    upsertState(
      account_id, module_name, def.page,
      unlocked_at, unlocked_by,
      JSON.stringify(milestone.progress_data || {}),
    );
    return buildStateRow(def, account_id, true, unlocked_at, unlocked_by, 100, milestone.preview_text);
  }

  // Not yet unlocked — record progress
  upsertState(
    account_id, module_name, def.page,
    null, null,
    JSON.stringify(milestone.progress_data || {}),
  );
  return buildStateRow(def, account_id, false, null, null, milestone.progress_pct, milestone.preview_text);
}

/**
 * Manual operator override — unlocks a module immediately for an account.
 * Bypasses the milestone check. Cannot be undone via re-evaluation.
 */
export function operatorUnlock(
  module_name: string,
  account_id: string = DEFAULT_ACCOUNT,
): ModuleStateRow | null {
  const def = getModule(module_name);
  if (!def) return null;
  const now = Math.floor(Date.now() / 1000);
  upsertState(account_id, module_name, def.page, now, 'operator', '{}');
  return buildStateRow(def, account_id, true, now, 'operator', 100, 'unlocked by operator');
}

/**
 * Walk every registered module for the given page and return the current
 * state. Used by GET /api/modules/state?page=<page>. Re-evaluates milestones
 * on each call (cheap; can be cached if needed at frontend).
 */
export async function getModulesForPage(
  page: ModulePage,
  account_id: string = DEFAULT_ACCOUNT,
): Promise<ModuleStateRow[]> {
  const defs = listModules(page);
  const out: ModuleStateRow[] = [];
  for (const def of defs) {
    const row = await evaluateModule(def.name, account_id);
    if (row) out.push(row);
  }
  return out;
}

/** Walk every module across every page (used by nightly sweep). */
export async function evaluateAll(account_id: string = DEFAULT_ACCOUNT): Promise<ModuleStateRow[]> {
  const defs = listModules();
  const out: ModuleStateRow[] = [];
  for (const def of defs) {
    const row = await evaluateModule(def.name, account_id);
    if (row) out.push(row);
  }
  return out;
}

/** Persist module unlock state. Upsert on (account_id, module_name). */
function upsertState(
  account_id: string,
  module_name: string,
  page: string,
  unlocked_at: number | null,
  unlocked_by: string | null,
  milestone_progress_json: string,
): void {
  const now = Math.floor(Date.now() / 1000);
  db().prepare(`
    INSERT INTO module_unlock_state
      (account_id, module_name, page, unlocked_at, unlocked_by, milestone_progress_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, module_name) DO UPDATE SET
      unlocked_at = COALESCE(module_unlock_state.unlocked_at, excluded.unlocked_at),
      unlocked_by = COALESCE(module_unlock_state.unlocked_by, excluded.unlocked_by),
      milestone_progress_json = excluded.milestone_progress_json,
      updated_at = excluded.updated_at
  `).run(account_id, module_name, page, unlocked_at, unlocked_by, milestone_progress_json, now, now);
}

/** Build the final ModuleStateRow for the API response. */
function buildStateRow(
  def: { name: string; display_name: string; page: ModulePage; preview_description: string; tour_text: string },
  account_id: string,
  unlocked: boolean,
  unlocked_at: number | null,
  unlocked_by: UnlockReason | null,
  progress_pct: number,
  preview_text: string,
): ModuleStateRow {
  const tour_seen = !!db().prepare(
    'SELECT 1 FROM module_tour_state WHERE account_id = ? AND module_name = ?',
  ).get(account_id, def.name);
  return {
    module_name: def.name,
    display_name: def.display_name,
    page: def.page,
    preview_description: def.preview_description,
    tour_text: def.tour_text,
    unlocked,
    unlocked_at,
    unlocked_by,
    progress_pct,
    preview_text,
    tour_seen,
  };
}

/** Mark a module's first-appearance tour as seen for this account. */
export function markTourSeen(module_name: string, account_id: string = DEFAULT_ACCOUNT): void {
  db().prepare(`
    INSERT INTO module_tour_state (account_id, module_name, tour_seen_at)
    VALUES (?, ?, ?)
    ON CONFLICT(account_id, module_name) DO NOTHING
  `).run(account_id, module_name, Math.floor(Date.now() / 1000));
}

/**
 * Append an action log entry. Powers Impact Tracker module + cross-page
 * unlock criteria (e.g. "3 acted-on verdicts" milestone).
 */
export function logAction(entry: {
  account_id?: string;
  page: string;
  action_type: string;
  action_target: string;
  taken_at?: number;
  outcome_json?: Record<string, unknown>;
}): void {
  const now = Math.floor(Date.now() / 1000);
  db().prepare(`
    INSERT INTO action_log
      (account_id, page, action_type, action_target, suggested_at, taken_at, outcome_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.account_id || DEFAULT_ACCOUNT,
    entry.page,
    entry.action_type,
    entry.action_target,
    now,
    entry.taken_at || null,
    JSON.stringify(entry.outcome_json || {}),
  );
}

/** Read recent actions for an account (for milestone evaluators). */
export function recentActions(
  account_id: string = DEFAULT_ACCOUNT,
  page?: string,
  since_unix?: number,
): Array<{
  page: string;
  action_type: string;
  action_target: string;
  suggested_at: number;
  taken_at: number | null;
  outcome_json: string;
}> {
  const since = since_unix || 0;
  const sql = page
    ? 'SELECT page, action_type, action_target, suggested_at, taken_at, outcome_json FROM action_log WHERE account_id = ? AND page = ? AND suggested_at >= ? ORDER BY suggested_at DESC'
    : 'SELECT page, action_type, action_target, suggested_at, taken_at, outcome_json FROM action_log WHERE account_id = ? AND suggested_at >= ? ORDER BY suggested_at DESC';
  const params = page ? [account_id, page, since] : [account_id, since];
  return db().prepare(sql).all(...params) as Array<{
    page: string;
    action_type: string;
    action_target: string;
    suggested_at: number;
    taken_at: number | null;
    outcome_json: string;
  }>;
}
