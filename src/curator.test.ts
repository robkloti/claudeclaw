/**
 * Tests for the curator's deterministic phase + snapshot/rollback. The DB
 * helpers are stubbed in-memory so we don't depend on better-sqlite3 here
 * (which has a NODE_MODULE_VERSION mismatch in some envs).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type {
  SkillLifecycleRow,
  SkillSnapshotRow,
} from './db.js';

let tempAgentDir = '';
let tempArchiveDir = '';
let tempSnapshotsDir = '';
let tempConfigDir = '';

// In-memory db stubs.
const fakeAgentSkills: SkillLifecycleRow[] = [];
const fakeSnapshots: SkillSnapshotRow[] = [];
const stateChanges: Array<{ skillId: string; state: string; reason: string }> = [];

vi.mock('./config.js', async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js');
  return {
    ...actual,
    get CLAUDECLAW_CONFIG() {
      return tempConfigDir;
    },
    get CLAUDECLAW_SKILLS_DIR() {
      return tempAgentDir;
    },
    get CLAUDECLAW_SKILLS_ARCHIVE() {
      return tempArchiveDir;
    },
    get CLAUDECLAW_SKILLS_SNAPSHOTS() {
      return tempSnapshotsDir;
    },
  };
});

vi.mock('./db.js', () => ({
  getAgentCreatedSkills: () => fakeAgentSkills,
  setSkillState: (skillId: string, state: string, reason: string): void => {
    stateChanges.push({ skillId, state, reason });
    const row = fakeAgentSkills.find((r) => r.skill_id === skillId);
    if (row) row.state = state as SkillLifecycleRow['state'];
  },
  recordSkillSnapshot: (snapshotPath: string, reason: string, byteSize: number): number => {
    const id = fakeSnapshots.length + 1;
    fakeSnapshots.unshift({
      id,
      snapshot_path: snapshotPath,
      reason,
      byte_size: byteSize,
      created_at: Math.floor(Date.now() / 1000),
    });
    return id;
  },
  listSkillSnapshots: (): SkillSnapshotRow[] => [...fakeSnapshots],
  deleteSkillSnapshot: (id: number): void => {
    const idx = fakeSnapshots.findIndex((s) => s.id === id);
    if (idx !== -1) fakeSnapshots.splice(idx, 1);
  },
  upsertSkillLifecycle: vi.fn(),
}));

let curator: typeof import('./curator.js');
let registry: typeof import('./skill-registry.js');

beforeEach(async () => {
  tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-test-config-'));
  tempAgentDir = path.join(tempConfigDir, 'skills');
  tempArchiveDir = path.join(tempAgentDir, '.archive');
  tempSnapshotsDir = path.join(tempConfigDir, 'skill-snapshots');
  fs.mkdirSync(tempAgentDir, { recursive: true });
  fakeAgentSkills.length = 0;
  fakeSnapshots.length = 0;
  stateChanges.length = 0;

  vi.resetModules();
  curator = await import('./curator.js');
  registry = await import('./skill-registry.js');
  registry.initSkillRegistry(undefined, tempAgentDir);
});

afterEach(() => {
  fs.rmSync(tempConfigDir, { recursive: true, force: true });
});

function seedSkillOnDisk(name: string, category = 'uncategorized'): string {
  const dir = path.join(tempAgentDir, category, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} seed\n---\nbody`,
  );
  return dir;
}

function seedLifecycle(
  name: string,
  partial: Partial<SkillLifecycleRow> = {},
): SkillLifecycleRow {
  const now = Math.floor(Date.now() / 1000);
  const row: SkillLifecycleRow = {
    skill_id: name,
    state: 'active',
    pinned: 0,
    created_by: 'agent',
    last_used_at: now,
    state_changed_at: now,
    state_reason: '',
    ...partial,
  };
  fakeAgentSkills.push(row);
  return row;
}

describe('runDeterministicPhase', () => {
  it('marks an unused-but-not-archived skill as stale', () => {
    const now = Math.floor(Date.now() / 1000);
    seedSkillOnDisk('s-stale');
    seedLifecycle('s-stale', { last_used_at: now - 60 * 86400 }); // 60d old
    registry.initSkillRegistry(undefined, tempAgentDir);

    const report = curator.runDeterministicPhase({ dryRun: false });
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].to).toBe('stale');
    expect(stateChanges).toEqual([
      expect.objectContaining({ skillId: 's-stale', state: 'stale' }),
    ]);
  });

  it('archives a skill past the archive threshold', () => {
    const now = Math.floor(Date.now() / 1000);
    const dir = seedSkillOnDisk('s-arch', 'devops');
    seedLifecycle('s-arch', { last_used_at: now - 100 * 86400 }); // 100d
    registry.initSkillRegistry(undefined, tempAgentDir);

    const report = curator.runDeterministicPhase({ dryRun: false });
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].to).toBe('archived');

    expect(fs.existsSync(dir)).toBe(false);
    const archived = fs.readdirSync(tempArchiveDir);
    expect(archived.some((n) => n.startsWith('s-arch-'))).toBe(true);
  });

  it('skips pinned skills', () => {
    const now = Math.floor(Date.now() / 1000);
    seedSkillOnDisk('s-pinned');
    seedLifecycle('s-pinned', {
      last_used_at: now - 200 * 86400,
      pinned: 1,
    });
    registry.initSkillRegistry(undefined, tempAgentDir);

    const report = curator.runDeterministicPhase({ dryRun: false });
    expect(report.changes).toHaveLength(0);
  });

  it('dryRun reports without mutating state or disk', () => {
    const now = Math.floor(Date.now() / 1000);
    const dir = seedSkillOnDisk('s-dry');
    seedLifecycle('s-dry', { last_used_at: now - 100 * 86400 });
    registry.initSkillRegistry(undefined, tempAgentDir);

    const report = curator.runDeterministicPhase({ dryRun: true });
    expect(report.changes).toHaveLength(1);
    expect(stateChanges).toHaveLength(0);
    expect(fs.existsSync(dir)).toBe(true);
  });
});

describe('takeSnapshot / rollbackSnapshot', () => {
  it('snapshot writes a tar.gz and rollback restores it', () => {
    const dir = seedSkillOnDisk('s-snap');

    const snap = curator.takeSnapshot('manual');
    expect(snap).not.toBeNull();
    expect(fs.existsSync(snap!.snapshot_path)).toBe(true);

    // Mutate after snapshot.
    fs.rmSync(dir, { recursive: true });
    expect(fs.existsSync(dir)).toBe(false);

    const result = curator.rollbackSnapshot();
    expect(fs.existsSync(dir)).toBe(true);
    expect(result.restored.id).toBe(snap!.id);
  });

  it('prunes snapshots beyond the configured keep count', () => {
    fs.writeFileSync(
      path.join(tempConfigDir, 'curator.json'),
      JSON.stringify({ backup: { enabled: true }, backupKeep: 2 }),
    );
    seedSkillOnDisk('s-keep');

    curator.takeSnapshot('a');
    curator.takeSnapshot('b');
    curator.takeSnapshot('c');

    expect(fakeSnapshots).toHaveLength(2);
  });
});
