/**
 * Curator — background service that keeps the agent-created skill tree clean.
 *
 * Phase 1 (deterministic, always runs):
 *   - Skills unused for `stale_after_days` → state='stale'
 *   - Skills unused for `archive_after_days` → move to .archive/, state='archived'
 *   - Pinned skills are skipped.
 *
 * Phase 2 (LLM review, optional):
 *   - Forks a subagent with skill_view + skill_manage access.
 *   - Subagent proposes consolidate/patch/archive for overlapping skills.
 *   - Proposals are written to skill_suggestions for user review (not auto-applied).
 *   - Stub for v1 — wired in but not yet implemented end-to-end.
 *
 * Safety:
 *   - Snapshot taken before every run.
 *   - Never auto-deletes. Worst case is move-to-archive, which is reversible.
 *   - One-command rollback via `curator-cli rollback`.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CLAUDECLAW_CONFIG,
  CLAUDECLAW_SKILLS_ARCHIVE,
  CLAUDECLAW_SKILLS_DIR,
  CLAUDECLAW_SKILLS_SNAPSHOTS,
} from './config.js';
import {
  deleteSkillSnapshot,
  getAgentCreatedSkills,
  listSkillSnapshots,
  recordSkillSnapshot,
  setSkillState,
  type SkillLifecycleRow,
  type SkillSnapshotRow,
} from './db.js';
import { logger } from './logger.js';
import { getSkill, reloadSkillRegistry } from './skill-registry.js';

// ── Config ──────────────────────────────────────────────────────────

export interface CuratorConfig {
  enabled: boolean;
  intervalHours: number;
  minIdleHours: number;
  staleAfterDays: number;
  archiveAfterDays: number;
  backupEnabled: boolean;
  backupKeep: number;
}

const DEFAULT_CONFIG: CuratorConfig = {
  enabled: true,
  intervalHours: 168,      // 7 days
  minIdleHours: 2,
  staleAfterDays: 30,
  archiveAfterDays: 90,
  backupEnabled: true,
  backupKeep: 5,
};

/**
 * Load the curator config from ~/.claudeclaw/curator.json if present.
 * Missing fields fall back to DEFAULT_CONFIG. A missing file means defaults
 * across the board.
 */
export function loadCuratorConfig(): CuratorConfig {
  const cfgPath = path.join(CLAUDECLAW_CONFIG, 'curator.json');
  if (!fs.existsSync(cfgPath)) return DEFAULT_CONFIG;
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as Partial<CuratorConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch (e) {
    logger.warn({ err: (e as Error).message, cfgPath }, 'Bad curator.json; using defaults');
    return DEFAULT_CONFIG;
  }
}

// ── Snapshot / rollback ─────────────────────────────────────────────

export function takeSnapshot(reason: string): SkillSnapshotRow | null {
  if (!fs.existsSync(CLAUDECLAW_SKILLS_DIR)) {
    logger.debug('No skill dir to snapshot; skipping');
    return null;
  }

  fs.mkdirSync(CLAUDECLAW_SKILLS_SNAPSHOTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(CLAUDECLAW_SKILLS_SNAPSHOTS, `skills-${stamp}.tar.gz`);

  try {
    // -C parent to make paths inside the tar relative ("skills/...") so the
    // archive is portable and restore is unambiguous.
    const parent = path.dirname(CLAUDECLAW_SKILLS_DIR);
    const base = path.basename(CLAUDECLAW_SKILLS_DIR);
    execSync(`tar -czf "${file}" -C "${parent}" "${base}"`, { stdio: 'ignore' });
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'Snapshot tar failed');
    return null;
  }

  const size = fs.statSync(file).size;
  const id = recordSkillSnapshot(file, reason, size);
  pruneOldSnapshots(loadCuratorConfig().backupKeep);
  return { id, snapshot_path: file, reason, byte_size: size, created_at: Math.floor(Date.now() / 1000) };
}

/** Keep the newest N snapshots; delete older tarballs + their DB rows. */
function pruneOldSnapshots(keep: number): void {
  const all = listSkillSnapshots();
  if (all.length <= keep) return;
  for (const row of all.slice(keep)) {
    try {
      if (fs.existsSync(row.snapshot_path)) fs.unlinkSync(row.snapshot_path);
    } catch {
      // best-effort cleanup
    }
    deleteSkillSnapshot(row.id);
  }
}

/**
 * Restore from a snapshot. Without args, picks the newest. With a snapshot
 * id, picks that specific one. Replaces CLAUDECLAW_SKILLS_DIR atomically by
 * renaming the existing tree aside first.
 */
export function rollbackSnapshot(snapshotId?: number): {
  restored: SkillSnapshotRow;
  savedAside: string | null;
} {
  const snaps = listSkillSnapshots();
  if (snaps.length === 0) throw new Error('No snapshots available to rollback to.');

  const target = snapshotId
    ? snaps.find((s) => s.id === snapshotId)
    : snaps[0];
  if (!target) throw new Error(`Snapshot id ${snapshotId} not found.`);
  if (!fs.existsSync(target.snapshot_path)) {
    throw new Error(`Snapshot file missing on disk: ${target.snapshot_path}`);
  }

  // Take a pre-rollback safety snapshot so the user can undo the undo.
  takeSnapshot('pre-rollback');

  // Move the current tree aside (don't delete — gives us another safety net).
  let savedAside: string | null = null;
  if (fs.existsSync(CLAUDECLAW_SKILLS_DIR)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    savedAside = `${CLAUDECLAW_SKILLS_DIR}.pre-rollback-${stamp}`;
    fs.renameSync(CLAUDECLAW_SKILLS_DIR, savedAside);
  }

  // Extract the tarball into the parent dir; the archive contains "skills/..."
  const parent = path.dirname(CLAUDECLAW_SKILLS_DIR);
  execSync(`tar -xzf "${target.snapshot_path}" -C "${parent}"`, { stdio: 'ignore' });

  reloadSkillRegistry();
  logger.info(
    { snapshotId: target.id, snapshotPath: target.snapshot_path, savedAside },
    'Rolled back skill tree from snapshot',
  );
  return { restored: target, savedAside };
}

// ── Curator phase 1 (deterministic) ─────────────────────────────────

export interface CuratorChange {
  skillId: string;
  from: SkillLifecycleRow['state'];
  to: SkillLifecycleRow['state'];
  reason: string;
}

export interface CuratorReport {
  ranAt: number;
  dryRun: boolean;
  scannedCount: number;
  changes: CuratorChange[];
  snapshotPath: string | null;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function daysSince(unix: number | null): number {
  if (!unix) return Number.POSITIVE_INFINITY;
  return (nowSec() - unix) / 86400;
}

/**
 * Run the deterministic transitions. Returns a report describing every state
 * change. With `dryRun: true`, computes the report but applies nothing.
 */
export function runDeterministicPhase(opts: {
  dryRun: boolean;
  config?: CuratorConfig;
}): CuratorReport {
  const cfg = opts.config ?? loadCuratorConfig();
  const skills = getAgentCreatedSkills();
  const changes: CuratorChange[] = [];

  for (const row of skills) {
    if (row.pinned) continue;
    if (row.state === 'archived') continue;

    // last_used_at falls back to state_changed_at (i.e. when we first saw
    // this skill) so a brand-new skill doesn't insta-stale.
    const referenceTs = row.last_used_at ?? row.state_changed_at;
    const ageDays = daysSince(referenceTs);

    if (ageDays >= cfg.archiveAfterDays) {
      changes.push({
        skillId: row.skill_id,
        from: row.state,
        to: 'archived',
        reason: `unused for ${ageDays.toFixed(1)} days (>= ${cfg.archiveAfterDays})`,
      });
    } else if (ageDays >= cfg.staleAfterDays && row.state === 'active') {
      changes.push({
        skillId: row.skill_id,
        from: 'active',
        to: 'stale',
        reason: `unused for ${ageDays.toFixed(1)} days (>= ${cfg.staleAfterDays})`,
      });
    }
  }

  let snapshotPath: string | null = null;

  if (!opts.dryRun && changes.length > 0) {
    if (cfg.backupEnabled) {
      const snap = takeSnapshot('pre-curator-run');
      snapshotPath = snap?.snapshot_path ?? null;
    }

    for (const ch of changes) {
      if (ch.to === 'archived') {
        archiveSkillFile(ch.skillId);
      }
      setSkillState(ch.skillId, ch.to, ch.reason);
    }

    reloadSkillRegistry();
  }

  return {
    ranAt: nowSec(),
    dryRun: opts.dryRun,
    scannedCount: skills.length,
    changes,
    snapshotPath,
  };
}

/** Move a skill's directory into .archive/. Safe no-op if already gone. */
function archiveSkillFile(skillId: string): void {
  const skill = getSkill(skillId);
  if (!skill) {
    // Already archived or registry stale — nothing to do on disk.
    return;
  }
  if (skill.source !== 'agent') {
    logger.warn({ skillId, source: skill.source }, 'Refusing to archive non-agent skill');
    return;
  }
  fs.mkdirSync(CLAUDECLAW_SKILLS_ARCHIVE, { recursive: true });
  const srcDir = path.dirname(skill.fullPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destDir = path.join(CLAUDECLAW_SKILLS_ARCHIVE, `${skillId}-${stamp}`);
  try {
    fs.renameSync(srcDir, destDir);
  } catch (e) {
    logger.error({ err: (e as Error).message, skillId }, 'Failed to move skill to archive');
  }
}

// ── Curator phase 2 (LLM review) ────────────────────────────────────

/**
 * Phase 2 stub. Production implementation forks a subagent that reads
 * every agent-created SKILL.md, identifies overlapping pairs, and writes
 * proposals to skill_suggestions. Wired into runCurator() but currently
 * a no-op so phase 1 can ship first. See plan §"Curator (mirror of
 * Hermes)" for the full design.
 */
export async function runLlmReviewPhase(_opts: {
  dryRun: boolean;
}): Promise<{ proposalsWritten: number }> {
  logger.info('LLM review phase: stub (not yet implemented)');
  return { proposalsWritten: 0 };
}

// ── Top-level orchestration ─────────────────────────────────────────

/**
 * Full curator run. Used by both the CLI (`curator-cli run`) and any
 * scheduled-task wiring that wants to fire the curator on a cron.
 */
export async function runCurator(opts: {
  dryRun?: boolean;
  skipLlm?: boolean;
} = {}): Promise<CuratorReport & { llmProposals: number }> {
  const dryRun = opts.dryRun ?? false;
  const phase1 = runDeterministicPhase({ dryRun });
  const phase2 = opts.skipLlm ? { proposalsWritten: 0 } : await runLlmReviewPhase({ dryRun });
  return { ...phase1, llmProposals: phase2.proposalsWritten };
}

/**
 * Idle gate: only run the curator if the user has been quiet for at least
 * `minIdleHours`. Matches Hermes's behavior — don't slug the user's machine
 * while they're actively working.
 */
export function shouldRunCurator(lastUserMessageUnix: number | null): boolean {
  const cfg = loadCuratorConfig();
  if (!cfg.enabled) return false;
  if (lastUserMessageUnix === null) return true;
  const idleHours = (nowSec() - lastUserMessageUnix) / 3600;
  return idleHours >= cfg.minIdleHours;
}
