/**
 * Tests for the skill_manage tool handlers. We exercise the handlers
 * directly via the `__test` export so we don't need to spin up the SDK.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// We need to redirect CLAUDECLAW_SKILLS_DIR + CLAUDECLAW_SKILLS_ARCHIVE
// to temp directories before skill-manage.ts is imported. Vitest evaluates
// vi.mock hoists before the import, so we mock config first.
let tempAgentDir = '';
let tempArchiveDir = '';

// initSkillRegistry is re-imported per-test (vi.resetModules) so handlers
// and tests share one registry instance.
let initRegistry: (typeof import('./skill-registry.js'))['initSkillRegistry'];

vi.mock('./config.js', async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js');
  return {
    ...actual,
    get CLAUDECLAW_SKILLS_DIR() {
      return tempAgentDir;
    },
    get CLAUDECLAW_SKILLS_ARCHIVE() {
      return tempArchiveDir;
    },
  };
});

// DB upsert is a no-op in tests — skill_lifecycle stays in memory-less mode.
// We stub it so we don't need to initDatabase().
vi.mock('./db.js', () => ({
  upsertSkillLifecycle: vi.fn(),
  setSkillState: vi.fn(),
}));

let __testApi: typeof import('./skill-manage.js')['__test'];

let tempProjectRoot = '';

beforeEach(async () => {
  tempProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-test-root-'));
  tempAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-test-agent-'));
  tempArchiveDir = path.join(tempAgentDir, '.archive');

  // Faux project root so registry init doesn't bail.
  fs.writeFileSync(path.join(tempProjectRoot, 'CLAUDE.md'), '# test');
  fs.mkdirSync(path.join(tempProjectRoot, 'skills'));

  // Fresh import so the module re-reads the getter-backed config paths.
  vi.resetModules();
  const mod = await import('./skill-manage.js');
  __testApi = mod.__test;
  initRegistry = (await import('./skill-registry.js')).initSkillRegistry;

  initRegistry(tempProjectRoot, tempAgentDir);
});

afterEach(() => {
  fs.rmSync(tempProjectRoot, { recursive: true, force: true });
  fs.rmSync(tempAgentDir, { recursive: true, force: true });
});

describe('handleCreate', () => {
  it('writes a new SKILL.md under the chosen category', async () => {
    const result = await __testApi.handleCreate({
      name: 'deploy-k8s',
      category: 'devops',
      content: `---
name: deploy-k8s
description: Deploy to k8s
---
# Deploy K8s
Procedure.`,
    });

    expect(result.isError).toBeFalsy();
    const written = path.join(tempAgentDir, 'devops', 'deploy-k8s', 'SKILL.md');
    expect(fs.existsSync(written)).toBe(true);
  });

  it('rejects invalid names', async () => {
    const result = await __testApi.handleCreate({
      name: 'BAD NAME',
      content: 'x',
    });
    expect(result.isError).toBe(true);
  });

  it('rejects collision with a bundled skill', async () => {
    // Seed a bundled skill called "bundled-skill".
    const dir = path.join(tempProjectRoot, 'skills', 'bundled-skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      '---\nname: bundled-skill\ndescription: bundled\n---',
    );
    initRegistry(tempProjectRoot, tempAgentDir);

    const result = await __testApi.handleCreate({
      name: 'bundled-skill',
      content: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('already exists');
  });

  it('defaults to uncategorized when category is omitted', async () => {
    const result = await __testApi.handleCreate({
      name: 'no-cat-skill',
      content: 'content',
    });
    expect(result.isError).toBeFalsy();
    expect(
      fs.existsSync(path.join(tempAgentDir, 'uncategorized', 'no-cat-skill', 'SKILL.md')),
    ).toBe(true);
  });
});

describe('handlePatch', () => {
  it('replaces a unique substring in the SKILL.md', async () => {
    await __testApi.handleCreate({
      name: 'patch-target',
      category: 'misc',
      content: 'header\nold-line\nfooter',
    });

    const r = await __testApi.handlePatch({
      name: 'patch-target',
      old_string: 'old-line',
      new_string: 'new-line',
    });
    expect(r.isError).toBeFalsy();

    const after = fs.readFileSync(
      path.join(tempAgentDir, 'misc', 'patch-target', 'SKILL.md'),
      'utf-8',
    );
    expect(after).toContain('new-line');
    expect(after).not.toContain('old-line');
  });

  it('refuses if old_string appears more than once', async () => {
    await __testApi.handleCreate({
      name: 'patch-amb',
      content: 'dup\ndup\n',
    });
    const r = await __testApi.handlePatch({
      name: 'patch-amb',
      old_string: 'dup',
      new_string: 'x',
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('appears');
  });

  it('refuses if old_string is not found', async () => {
    await __testApi.handleCreate({ name: 'nope', content: 'hello' });
    const r = await __testApi.handlePatch({
      name: 'nope',
      old_string: 'absent',
      new_string: 'x',
    });
    expect(r.isError).toBe(true);
  });
});

describe('handleDelete', () => {
  it('moves the skill directory into the archive', async () => {
    await __testApi.handleCreate({
      name: 'soon-archived',
      category: 'misc',
      content: 'hello',
    });
    const skillDir = path.join(tempAgentDir, 'misc', 'soon-archived');
    expect(fs.existsSync(skillDir)).toBe(true);

    const r = await __testApi.handleDelete({ name: 'soon-archived' });
    expect(r.isError).toBeFalsy();
    expect(fs.existsSync(skillDir)).toBe(false);

    const archived = fs.readdirSync(tempArchiveDir);
    expect(archived.some((n) => n.startsWith('soon-archived-'))).toBe(true);
  });
});

describe('handleWriteFile bundle safety', () => {
  it('writes inside references/', async () => {
    await __testApi.handleCreate({ name: 'bundle-host', content: 'x' });
    const r = await __testApi.handleWriteFile({
      name: 'bundle-host',
      file_path: 'references/notes.md',
      file_content: 'hi',
    });
    expect(r.isError).toBeFalsy();
    expect(
      fs.existsSync(path.join(tempAgentDir, 'uncategorized', 'bundle-host', 'references', 'notes.md')),
    ).toBe(true);
  });

  it('refuses path traversal', async () => {
    await __testApi.handleCreate({ name: 'bundle-host2', content: 'x' });
    const r = await __testApi.handleWriteFile({
      name: 'bundle-host2',
      file_path: '../escape.md',
      file_content: 'hi',
    });
    expect(r.isError).toBe(true);
  });

  it('refuses unknown subfolders', async () => {
    await __testApi.handleCreate({ name: 'bundle-host3', content: 'x' });
    const r = await __testApi.handleWriteFile({
      name: 'bundle-host3',
      file_path: 'secrets/keys.txt',
      file_content: 'hi',
    });
    expect(r.isError).toBe(true);
  });
});
