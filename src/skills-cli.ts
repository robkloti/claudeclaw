#!/usr/bin/env node
/**
 * ClaudeClaw Skills CLI — manual control over the self-evolving skill set.
 *
 * Usage:
 *   node dist/skills-cli.js list
 *   node dist/skills-cli.js view <name>
 *   node dist/skills-cli.js pin <name>
 *   node dist/skills-cli.js unpin <name>
 *   node dist/skills-cli.js archive <name>
 *   node dist/skills-cli.js restore <name>
 *
 * Mirrors the Hermes `hermes skills` UX so Rob can inspect or kill a bad
 * agent-created skill fast without touching the database.
 */

import fs from 'fs';
import path from 'path';

import { CLAUDECLAW_SKILLS_ARCHIVE, CLAUDECLAW_SKILLS_DIR } from './config.js';
import {
  getAllSkillLifecycle,
  getSkillLifecycle,
  initDatabase,
  setSkillPinned,
  setSkillState,
} from './db.js';
import {
  getAllSkills,
  getSkill,
  initSkillRegistry,
} from './skill-registry.js';

initDatabase();
initSkillRegistry();

const [, , command, ...rest] = process.argv;

function findArchivedSkillDir(name: string): string | null {
  if (!fs.existsSync(CLAUDECLAW_SKILLS_ARCHIVE)) return null;
  // Archived dirs are named "<skill-id>-<timestamp>". Newest wins.
  const candidates = fs
    .readdirSync(CLAUDECLAW_SKILLS_ARCHIVE, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(`${name}-`))
    .map((d) => ({
      name: d.name,
      full: path.join(CLAUDECLAW_SKILLS_ARCHIVE, d.name),
      mtime: fs.statSync(path.join(CLAUDECLAW_SKILLS_ARCHIVE, d.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.full ?? null;
}

switch (command) {
  case 'list': {
    const skills = getAllSkills();
    const lifecycle = new Map(getAllSkillLifecycle().map((r) => [r.skill_id, r]));
    if (skills.length === 0) {
      console.log('No skills registered.');
      break;
    }
    const sourceWidth = Math.max(...skills.map((s) => s.source.length), 6);
    for (const s of skills.sort((a, b) => a.id.localeCompare(b.id))) {
      const life = lifecycle.get(s.id);
      const pin = life?.pinned ? ' [pinned]' : '';
      const state = life?.state && life.state !== 'active' ? ` [${life.state}]` : '';
      const cat = s.category ? ` [${s.category}]` : '';
      console.log(
        `${s.id.padEnd(28)} ${s.source.padEnd(sourceWidth)}${cat}${pin}${state}  ${s.description}`,
      );
    }
    break;
  }

  case 'view': {
    const name = rest[0];
    if (!name) {
      console.error('Usage: skills-cli view <name>');
      process.exit(1);
    }
    const skill = getSkill(name);
    if (!skill) {
      console.error(`Unknown skill "${name}"`);
      process.exit(1);
    }
    console.log(fs.readFileSync(skill.fullPath, 'utf-8'));
    break;
  }

  case 'pin':
  case 'unpin': {
    const name = rest[0];
    if (!name) {
      console.error(`Usage: skills-cli ${command} <name>`);
      process.exit(1);
    }
    if (!getSkillLifecycle(name)) {
      console.error(`Unknown skill "${name}". Has it been registered yet?`);
      process.exit(1);
    }
    setSkillPinned(name, command === 'pin');
    console.log(`${command === 'pin' ? 'Pinned' : 'Unpinned'} "${name}".`);
    break;
  }

  case 'archive': {
    const name = rest[0];
    if (!name) {
      console.error('Usage: skills-cli archive <name>');
      process.exit(1);
    }
    const skill = getSkill(name);
    if (!skill) {
      console.error(`Unknown skill "${name}"`);
      process.exit(1);
    }
    if (skill.source !== 'agent') {
      console.error(`Cannot archive a "${skill.source}" skill. Only agent-created skills are archivable.`);
      process.exit(1);
    }
    fs.mkdirSync(CLAUDECLAW_SKILLS_ARCHIVE, { recursive: true });
    const srcDir = path.dirname(skill.fullPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destDir = path.join(CLAUDECLAW_SKILLS_ARCHIVE, `${name}-${stamp}`);
    fs.renameSync(srcDir, destDir);
    setSkillState(name, 'archived', 'manual archive via skills-cli');
    console.log(`Archived "${name}" to ${destDir}.`);
    break;
  }

  case 'restore': {
    const name = rest[0];
    if (!name) {
      console.error('Usage: skills-cli restore <name>');
      process.exit(1);
    }
    const archived = findArchivedSkillDir(name);
    if (!archived) {
      console.error(`No archived skill found for "${name}".`);
      process.exit(1);
    }
    // Recover original category from the archived directory's parent path if
    // it was preserved; otherwise restore to uncategorized.
    const destCategory = 'uncategorized';
    const destDir = path.join(CLAUDECLAW_SKILLS_DIR, destCategory, name);
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    if (fs.existsSync(destDir)) {
      console.error(`Active skill "${name}" already exists at ${destDir}. Move it aside first.`);
      process.exit(1);
    }
    fs.renameSync(archived, destDir);
    setSkillState(name, 'active', 'restored via skills-cli');
    console.log(`Restored "${name}" to ${destDir}.`);
    break;
  }

  default:
    console.error('Usage:');
    console.error('  skills-cli list');
    console.error('  skills-cli view <name>');
    console.error('  skills-cli pin <name>');
    console.error('  skills-cli unpin <name>');
    console.error('  skills-cli archive <name>');
    console.error('  skills-cli restore <name>');
    process.exit(1);
}
