#!/usr/bin/env node
/**
 * ClaudeClaw Curator CLI — manual control over the curator.
 *
 * Usage:
 *   node dist/curator-cli.js status
 *   node dist/curator-cli.js run [--dry-run] [--skip-llm]
 *   node dist/curator-cli.js backup
 *   node dist/curator-cli.js rollback [--list] [-y] [--id <n>]
 *   node dist/curator-cli.js pause
 *   node dist/curator-cli.js resume
 *
 * Mirrors the Hermes `hermes curator` UX.
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { CLAUDECLAW_CONFIG } from './config.js';
import {
  getAgentCreatedSkills,
  initDatabase,
  listSkillSnapshots,
} from './db.js';
import {
  loadCuratorConfig,
  rollbackSnapshot,
  runCurator,
  takeSnapshot,
} from './curator.js';
import { initSkillRegistry } from './skill-registry.js';

initDatabase();
initSkillRegistry();

const [, , command, ...rest] = process.argv;
const flags = new Set(rest);

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function formatTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(prompt, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function setPaused(paused: boolean): void {
  const cfgPath = path.join(CLAUDECLAW_CONFIG, 'curator.json');
  let raw: Record<string, unknown> = {};
  try {
    if (fs.existsSync(cfgPath)) raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  } catch {
    // Reset to empty on bad JSON.
  }
  raw.enabled = !paused;
  fs.mkdirSync(CLAUDECLAW_CONFIG, { recursive: true });
  fs.writeFileSync(cfgPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');
}

async function main(): Promise<void> {
  switch (command) {
    case 'status': {
      const cfg = loadCuratorConfig();
      const skills = getAgentCreatedSkills();
      const snaps = listSkillSnapshots();
      const states = skills.reduce<Record<string, number>>((acc, s) => {
        acc[s.state] = (acc[s.state] ?? 0) + 1;
        return acc;
      }, {});
      console.log(`Curator: ${cfg.enabled ? 'enabled' : 'PAUSED'}`);
      console.log(`Cadence: every ${cfg.intervalHours}h, idle gate ${cfg.minIdleHours}h`);
      console.log(`Thresholds: stale after ${cfg.staleAfterDays}d, archive after ${cfg.archiveAfterDays}d`);
      console.log(`Agent-created skills: ${skills.length}`);
      for (const [state, count] of Object.entries(states)) {
        console.log(`  ${state}: ${count}`);
      }
      console.log(`Snapshots on disk: ${snaps.length} (keeping ${cfg.backupKeep})`);
      break;
    }

    case 'run': {
      const dryRun = flags.has('--dry-run');
      const skipLlm = flags.has('--skip-llm');
      console.log(`Running curator (dryRun=${dryRun}, skipLlm=${skipLlm})...`);
      const report = await runCurator({ dryRun, skipLlm });
      console.log(`Scanned ${report.scannedCount} agent-created skills.`);
      if (report.changes.length === 0) {
        console.log('No state changes.');
      } else {
        for (const ch of report.changes) {
          console.log(`  ${ch.skillId}: ${ch.from} → ${ch.to}  (${ch.reason})`);
        }
      }
      if (report.snapshotPath) {
        console.log(`Pre-run snapshot: ${report.snapshotPath}`);
      }
      console.log(`LLM proposals written: ${report.llmProposals}`);
      break;
    }

    case 'backup': {
      const snap = takeSnapshot('manual');
      if (!snap) {
        console.error('No skills dir to back up.');
        process.exit(1);
      }
      console.log(`Snapshot #${snap.id} written to ${snap.snapshot_path} (${formatBytes(snap.byte_size)}).`);
      break;
    }

    case 'rollback': {
      const list = flags.has('--list');
      const yes = flags.has('-y') || flags.has('--yes');
      const idIdx = rest.indexOf('--id');
      const idArg = idIdx !== -1 ? Number.parseInt(rest[idIdx + 1] ?? '', 10) : undefined;

      if (list) {
        const snaps = listSkillSnapshots();
        if (snaps.length === 0) {
          console.log('No snapshots.');
          break;
        }
        for (const s of snaps) {
          console.log(
            `#${String(s.id).padStart(4)}  ${formatTime(s.created_at)}  ${formatBytes(s.byte_size).padStart(8)}  ${s.reason}  ${s.snapshot_path}`,
          );
        }
        break;
      }

      const snaps = listSkillSnapshots();
      const target = idArg !== undefined && !Number.isNaN(idArg)
        ? snaps.find((s) => s.id === idArg)
        : snaps[0];
      if (!target) {
        console.error(idArg ? `No snapshot with id ${idArg}.` : 'No snapshots to roll back to.');
        process.exit(1);
      }

      if (!yes) {
        const okGo = await confirm(
          `Rollback to snapshot #${target.id} (${formatTime(target.created_at)})? [y/N] `,
        );
        if (!okGo) {
          console.log('Aborted.');
          break;
        }
      }

      const result = rollbackSnapshot(target.id);
      console.log(`Restored snapshot #${result.restored.id}.`);
      if (result.savedAside) {
        console.log(`Previous tree moved to: ${result.savedAside} (delete when satisfied).`);
      }
      break;
    }

    case 'pause':
      setPaused(true);
      console.log('Curator paused. Scheduled runs will skip until you call: curator-cli resume');
      break;

    case 'resume':
      setPaused(false);
      console.log('Curator resumed.');
      break;

    default:
      console.error('Usage:');
      console.error('  curator-cli status');
      console.error('  curator-cli run [--dry-run] [--skip-llm]');
      console.error('  curator-cli backup');
      console.error('  curator-cli rollback [--list] [-y] [--id <n>]');
      console.error('  curator-cli pause');
      console.error('  curator-cli resume');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
