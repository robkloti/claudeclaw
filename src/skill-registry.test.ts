import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  initSkillRegistry,
  reloadSkillRegistry,
  getSkillIndex,
  matchSkills,
  getSkillInstructions,
  getAllSkills,
  getSkill,
} from './skill-registry.js';

// ── Helpers ─────────────────────────────────────────────────────────

function createTempSkillDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-reg-test-'));
}

function writeSkill(baseDir: string, skillName: string, content: string): void {
  const dir = path.join(baseDir, skillName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
}

// We need to override the scan paths. The cleanest way is to temporarily
// create a skills/ directory alongside a fake CLAUDE.md.

let tempRoot: string;
let tempGlobal: string;
let origHome: string;

beforeEach(() => {
  tempRoot = createTempSkillDir();
  tempGlobal = createTempSkillDir();
  origHome = process.env.HOME || os.homedir();

  // Create structure: tempRoot is a fake project root with CLAUDE.md
  fs.writeFileSync(path.join(tempRoot, 'CLAUDE.md'), '# test');
  fs.mkdirSync(path.join(tempRoot, 'skills'), { recursive: true });

  // Create structure for global skills
  const globalSkillsDir = path.join(tempGlobal, '.claude', 'skills');
  fs.mkdirSync(globalSkillsDir, { recursive: true });

  // Override HOME so global skills scan finds our temp dir
  process.env.HOME = tempGlobal;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(tempGlobal, { recursive: true, force: true });
});

// ── Scan and discovery ──────────────────────────────────────────────

describe('initSkillRegistry', () => {
  it('finds skills in a scanned directory', () => {
    writeSkill(
      path.join(tempRoot, 'skills'),
      'gmail',
      `---
name: Gmail Manager
description: Manage Gmail inbox
triggers: email, inbox, gmail
---
# Gmail Manager

Read and send emails.`,
    );

    // We need to init from our temp root. The module uses import.meta.url
    // to find the project root, so we call initSkillRegistry which scans
    // ~/.claude/skills/ (our temp) and the project skills/.
    // For testing, we directly call the internal scanDirectory concept
    // by setting up global skills in our temp HOME.
    writeSkill(
      path.join(tempGlobal, '.claude', 'skills'),
      'gmail',
      `---
name: Gmail Manager
description: Manage Gmail inbox
triggers: email, inbox, gmail
---
# Gmail Manager

Read and send emails.`,
    );

    initSkillRegistry(tempRoot);
    const all = getAllSkills();
    // Should find at least the global skill
    const gmailSkill = all.find((s) => s.id === 'gmail');
    expect(gmailSkill).toBeDefined();
    expect(gmailSkill!.name).toBe('Gmail Manager');
    expect(gmailSkill!.description).toBe('Manage Gmail inbox');
    expect(gmailSkill!.triggerWords).toContain('email');
    expect(gmailSkill!.triggerWords).toContain('inbox');
    expect(gmailSkill!.triggerWords).toContain('gmail');
  });

  it('handles missing skill directories gracefully', () => {
    // Remove the skills dirs so there is nothing to scan
    fs.rmSync(path.join(tempGlobal, '.claude', 'skills'), { recursive: true, force: true });
    // initSkillRegistry should not throw
    expect(() => initSkillRegistry(tempRoot)).not.toThrow();
    expect(getAllSkills()).toHaveLength(0);
  });
});

// ── Frontmatter parsing ─────────────────────────────────────────────

describe('frontmatter parsing', () => {
  it('parses YAML frontmatter correctly', () => {
    writeSkill(
      path.join(tempGlobal, '.claude', 'skills'),
      'calendar',
      `---
name: Google Calendar
description: Manage calendar events
triggers: schedule, meeting, calendar
---
# Google Calendar

Create and manage events.`,
    );

    initSkillRegistry(tempRoot);
    const cal = getAllSkills().find((s) => s.id === 'calendar');
    expect(cal).toBeDefined();
    expect(cal!.name).toBe('Google Calendar');
    expect(cal!.description).toBe('Manage calendar events');
    expect(cal!.triggerWords).toEqual(['schedule', 'meeting', 'calendar']);
  });

  it('falls back to H1 and first paragraph when no frontmatter', () => {
    writeSkill(
      path.join(tempGlobal, '.claude', 'skills'),
      'todo',
      `# Task Manager

Show outstanding tasks from the vault. Supports checkboxes.

## Usage

Run /todo to see tasks.`,
    );

    initSkillRegistry(tempRoot);
    const todo = getAllSkills().find((s) => s.id === 'todo');
    expect(todo).toBeDefined();
    expect(todo!.name).toBe('Task Manager');
    expect(todo!.description).toBe('Show outstanding tasks from the vault. Supports checkboxes.');
  });

  it('falls back to directory name when no H1 or frontmatter', () => {
    writeSkill(
      path.join(tempGlobal, '.claude', 'skills'),
      'my-skill',
      'Just some plain text content here.',
    );

    initSkillRegistry(tempRoot);
    const skill = getAllSkills().find((s) => s.id === 'my-skill');
    expect(skill).toBeDefined();
    expect(skill!.name).toBe('my-skill');
  });
});

// ── matchSkills ─────────────────────────────────────────────────────

describe('matchSkills', () => {
  beforeEach(() => {
    writeSkill(
      path.join(tempGlobal, '.claude', 'skills'),
      'gmail',
      `---
name: Gmail
description: Email management
triggers: email, inbox, gmail
---`,
    );

    writeSkill(
      path.join(tempGlobal, '.claude', 'skills'),
      'calendar',
      `---
name: Calendar
description: Calendar management
triggers: schedule, meeting, calendar
---`,
    );

    initSkillRegistry(tempRoot);
  });

  it('matches "check my email" to gmail skill', () => {
    const matches = matchSkills('check my email');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((s) => s.id === 'gmail')).toBe(true);
  });

  it('matches "schedule a meeting" to calendar skill', () => {
    const matches = matchSkills('schedule a meeting');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((s) => s.id === 'calendar')).toBe(true);
  });

  it('returns empty array for unrelated messages', () => {
    const matches = matchSkills('hello');
    expect(matches).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const matches = matchSkills('Check My EMAIL');
    expect(matches.some((s) => s.id === 'gmail')).toBe(true);
  });
});

// ── getSkillIndex ───────────────────────────────────────────────────

describe('getSkillIndex', () => {
  it('returns compact skill_id: description format', () => {
    writeSkill(
      path.join(tempGlobal, '.claude', 'skills'),
      'gmail',
      `---
name: Gmail
description: Email management
triggers: email
---`,
    );

    initSkillRegistry(tempRoot);
    const index = getSkillIndex();
    expect(index).toContain('gmail: Email management');
  });

  it('returns empty string when no skills', () => {
    fs.rmSync(path.join(tempGlobal, '.claude', 'skills'), { recursive: true, force: true });
    initSkillRegistry(tempRoot);
    expect(getSkillIndex()).toBe('');
  });
});

// ── getSkillInstructions ────────────────────────────────────────────

describe('getSkillInstructions', () => {
  it('returns full SKILL.md content', () => {
    const content = `---
name: Gmail
description: Email management
triggers: email
---
# Gmail

Full instructions here.`;

    writeSkill(path.join(tempGlobal, '.claude', 'skills'), 'gmail', content);

    initSkillRegistry(tempRoot);
    const instructions = getSkillInstructions('gmail');
    expect(instructions).toBe(content);
  });

  it('returns null for unknown skill ID', () => {
    initSkillRegistry(tempRoot);
    expect(getSkillInstructions('nonexistent')).toBeNull();
  });
});

// ── Edge cases ──────────────────────────────────────────────────────

describe('agent-writable root (nested categories)', () => {
  let tempAgent: string;

  beforeEach(() => {
    tempAgent = createTempSkillDir();
  });

  afterEach(() => {
    fs.rmSync(tempAgent, { recursive: true, force: true });
  });

  it('discovers skills nested under category subfolders', () => {
    const skillDir = path.join(tempAgent, 'devops', 'deploy-k8s');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: deploy-k8s
description: Deploy a service to Kubernetes
metadata:
  claw:
    tags: [kubernetes, deploy]
    category: devops
---
# Deploy K8s

Procedure goes here.`,
    );

    initSkillRegistry(tempRoot, tempAgent);
    const s = getSkill('deploy-k8s');
    expect(s).toBeDefined();
    expect(s!.source).toBe('agent');
    expect(s!.category).toBe('devops');
    expect(s!.triggerWords).toEqual(['kubernetes', 'deploy']);
  });

  it('agent skill overrides bundled skill with same id', () => {
    writeSkill(
      path.join(tempRoot, 'skills'),
      'gmail',
      `---
name: Gmail Bundled
description: bundled gmail
triggers: email
---`,
    );
    const agentDir = path.join(tempAgent, 'comms', 'gmail');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, 'SKILL.md'),
      `---
name: Gmail Agent
description: agent-evolved gmail
metadata:
  claw:
    tags: [email]
---`,
    );

    initSkillRegistry(tempRoot, tempAgent);
    const s = getSkill('gmail');
    expect(s).toBeDefined();
    expect(s!.source).toBe('agent');
    expect(s!.description).toBe('agent-evolved gmail');
  });

  it('also accepts flat <root>/<name>/SKILL.md inside the agent root', () => {
    const flat = path.join(tempAgent, 'ad-hoc');
    fs.mkdirSync(flat, { recursive: true });
    fs.writeFileSync(
      path.join(flat, 'SKILL.md'),
      `---
name: ad-hoc
description: flat layout
---`,
    );
    initSkillRegistry(tempRoot, tempAgent);
    expect(getSkill('ad-hoc')).toBeDefined();
  });

  it('reloadSkillRegistry picks up newly-written agent skills', () => {
    initSkillRegistry(tempRoot, tempAgent);
    expect(getSkill('hot-reload-test')).toBeUndefined();

    const dir = path.join(tempAgent, 'misc', 'hot-reload-test');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---
name: hot-reload-test
description: should appear after reload
---`,
    );

    reloadSkillRegistry();
    expect(getSkill('hot-reload-test')).toBeDefined();
  });
});

describe('edge cases', () => {
  it('skips hidden directories', () => {
    const hiddenDir = path.join(tempGlobal, '.claude', 'skills', '.hidden');
    fs.mkdirSync(hiddenDir, { recursive: true });
    fs.writeFileSync(path.join(hiddenDir, 'SKILL.md'), '# Hidden');

    initSkillRegistry(tempRoot);
    expect(getAllSkills().find((s) => s.id === '.hidden')).toBeUndefined();
  });

  it('skips directories without any .md files', () => {
    const emptyDir = path.join(tempGlobal, '.claude', 'skills', 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    fs.writeFileSync(path.join(emptyDir, 'config.json'), '{}');

    initSkillRegistry(tempRoot);
    expect(getAllSkills().find((s) => s.id === 'empty')).toBeUndefined();
  });

  it('uses first .md file when SKILL.md is absent', () => {
    const skillDir = path.join(tempGlobal, '.claude', 'skills', 'alt');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'readme.md'), '# Alt Skill\n\nAlt description.');

    initSkillRegistry(tempRoot);
    const alt = getAllSkills().find((s) => s.id === 'alt');
    expect(alt).toBeDefined();
    expect(alt!.name).toBe('Alt Skill');
  });
});
