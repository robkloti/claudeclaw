import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import yaml from 'js-yaml';

import { CLAUDECLAW_SKILLS_DIR } from './config.js';
import { upsertSkillLifecycle } from './db.js';
import { logger } from './logger.js';

// ── Types ───────────────────────────────────────────────────────────

export type SkillSource = 'agent' | 'bundled' | 'global';

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  triggerWords: string[];
  fullPath: string;
  source: SkillSource;
  /** Hermes-style category (subfolder under the agent root). Empty for legacy skills. */
  category: string;
  /** Optional version string from frontmatter. */
  version?: string;
}

// ── Internal state ──────────────────────────────────────────────────

const skills: Map<string, SkillMeta> = new Map();

/**
 * Override paths captured by the most recent initSkillRegistry() call so
 * reloadSkillRegistry() can re-scan with the same scope. Production code
 * calls init once at boot with no overrides; tests pass overrides each run.
 */
interface RegistryOverrides {
  projectRootOverride?: string;
  agentSkillsDirOverride?: string;
}
let lastOverrides: RegistryOverrides = {};

// ── Frontmatter parsing ─────────────────────────────────────────────

interface Frontmatter {
  name?: string;
  description?: string;
  triggers?: string[] | string;
  version?: string;
  metadata?: {
    claw?: {
      tags?: string[] | string;
      category?: string;
    };
    hermes?: {
      tags?: string[] | string;
      category?: string;
    };
  };
}

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }

  const endIdx = trimmed.indexOf('---', 3);
  if (endIdx === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlBlock = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 3).trim();

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlBlock);
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'YAML parse failed, treating as no frontmatter');
    return { frontmatter: {}, body };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { frontmatter: {}, body };
  }

  return { frontmatter: parsed as Frontmatter, body };
}

/**
 * Resolve trigger words from frontmatter. Order of preference:
 *   1. `metadata.claw.tags` (new Hermes-mirror form)
 *   2. `metadata.hermes.tags` (Hermes skill bundles, treated identically)
 *   3. `triggers` (legacy flat form — string with commas OR array)
 *   4. Words from the name (length > 2)
 */
function resolveTriggers(fm: Frontmatter, fallbackName: string): string[] {
  const candidates: Array<string[] | string | undefined> = [
    fm.metadata?.claw?.tags,
    fm.metadata?.hermes?.tags,
    fm.triggers,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) {
      return c.map((s) => String(s).toLowerCase()).filter(Boolean);
    }
    if (typeof c === 'string' && c.trim()) {
      return c.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
  }

  return fallbackName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
}

function extractFirstH1(body: string): string | undefined {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}

function extractFirstParagraph(body: string): string {
  const lines = body.split('\n');
  const paragraphLines: string[] = [];
  let started = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!started) {
      if (!trimmed || trimmed.startsWith('#')) continue;
      started = true;
    }
    if (started) {
      if (!trimmed) break;
      if (trimmed.startsWith('#')) break;
      paragraphLines.push(trimmed);
    }
  }

  return paragraphLines.join(' ').slice(0, 200);
}

// ── Skill scanning ──────────────────────────────────────────────────

function findSkillFile(dir: string): string | null {
  const skillMd = path.join(dir, 'SKILL.md');
  if (fs.existsSync(skillMd)) return skillMd;

  // Fall back to first .md file (legacy support — some bundled skills used readme.md).
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        return path.join(dir, entry.name);
      }
    }
  } catch {
    // Directory not readable
  }
  return null;
}

function registerSkill(
  skillFile: string,
  skillId: string,
  category: string,
  source: SkillSource,
): void {
  let content: string;
  try {
    content = fs.readFileSync(skillFile, 'utf-8');
  } catch {
    logger.warn({ skillFile }, 'Could not read skill file');
    return;
  }

  const { frontmatter, body } = parseFrontmatter(content);
  const fmName = typeof frontmatter.name === 'string' ? frontmatter.name : undefined;
  const fmDesc = typeof frontmatter.description === 'string' ? frontmatter.description : undefined;
  const name = fmName || extractFirstH1(body) || skillId;
  const description = fmDesc || extractFirstParagraph(body);
  const triggerWords = resolveTriggers(frontmatter, name);
  const version =
    typeof frontmatter.version === 'string' ? frontmatter.version : undefined;

  const meta: SkillMeta = {
    id: skillId,
    name,
    description,
    triggerWords,
    fullPath: skillFile,
    source,
    category,
    ...(version ? { version } : {}),
  };

  if (skills.has(meta.id)) return;
  skills.set(meta.id, meta);

  // Mirror the registry into skill_lifecycle so the Curator can find this
  // skill later. Idempotent — ON CONFLICT DO NOTHING in the SQL.
  try {
    upsertSkillLifecycle(meta.id, source);
  } catch (err) {
    // DB may not be initialized in some CLI contexts — log but don't fail.
    logger.debug(
      { err: (err as Error).message, skillId: meta.id },
      'Could not upsert skill_lifecycle (db may not be initialized)',
    );
  }
}

/** Scan a flat <dir>/<name>/SKILL.md layout. Used for bundled + global skills. */
function scanFlatDirectory(dir: string, source: SkillSource): void {
  if (!fs.existsSync(dir)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    logger.warn({ dir }, 'Could not read skill directory');
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const skillDir = path.join(dir, entry.name);
    const skillFile = findSkillFile(skillDir);
    if (!skillFile) continue;

    registerSkill(skillFile, entry.name, '', source);
  }
}

/**
 * Scan a nested <root>/<category>/<name>/SKILL.md layout. Used for the
 * agent-writable root so the agent can group skills by domain (devops,
 * scraping, ad-creative, etc.) without exploding the top-level listing.
 *
 * Also supports flat <root>/<name>/SKILL.md inside the agent root for the
 * "no category specified" path — the agent can omit the category param to
 * skill_manage and we'll write to <root>/uncategorized/<name>/SKILL.md, but
 * if someone hand-creates a skill directly at the root we still find it.
 */
function scanCategorizedDirectory(root: string, source: SkillSource): void {
  if (!fs.existsSync(root)) return;

  let topEntries: fs.Dirent[];
  try {
    topEntries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    logger.warn({ dir: root }, 'Could not read agent skill root');
    return;
  }

  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue; // .archive, .snapshots, etc.

    const subdir = path.join(root, entry.name);

    // Case A: this dir is itself a skill (flat layout — SKILL.md right inside).
    const flatSkill = path.join(subdir, 'SKILL.md');
    if (fs.existsSync(flatSkill)) {
      registerSkill(flatSkill, entry.name, '', source);
      continue;
    }

    // Case B: this is a category dir — walk one level deeper.
    let innerEntries: fs.Dirent[];
    try {
      innerEntries = fs.readdirSync(subdir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const inner of innerEntries) {
      if (!inner.isDirectory()) continue;
      if (inner.name.startsWith('.')) continue;

      const skillDir = path.join(subdir, inner.name);
      const skillFile = findSkillFile(skillDir);
      if (!skillFile) continue;

      registerSkill(skillFile, inner.name, entry.name, source);
    }
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Scan all three skill roots into the in-memory registry. Safe to call
 * multiple times — clears prior state first.
 *
 * Priority order (first registration wins on ID collision):
 *   1. Agent-writable root (CLAUDECLAW_SKILLS_DIR, default ~/.claudeclaw/skills/)
 *   2. Project bundled (<projectRoot>/skills/)
 *   3. Global (~/.claude/skills/)
 *
 * Agent-created skills win over bundled so a learned variant of a bundled
 * skill takes precedence — matches Hermes's "bundled is the floor, agent
 * builds up from there" model.
 *
 * Overrides:
 *   - projectRootOverride: redirect the bundled scan (used by tests)
 *   - agentSkillsDirOverride: redirect the agent-writable scan (used by tests)
 */
export function initSkillRegistry(
  projectRootOverride?: string,
  agentSkillsDirOverride?: string,
): void {
  skills.clear();
  lastOverrides = { projectRootOverride, agentSkillsDirOverride };

  // fileURLToPath decodes URL-encoded characters (e.g. %20 → space). The
  // previous implementation used `new URL(import.meta.url).pathname` which
  // left %20 in the path and silently broke project skills for clones in
  // dirs with spaces.
  const projectRoot = projectRootOverride
    ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  if (!fs.existsSync(path.join(projectRoot, 'CLAUDE.md'))) {
    logger.debug({ projectRoot }, 'CLAUDE.md not found at expected project root');
  }

  const agentRoot = agentSkillsDirOverride ?? CLAUDECLAW_SKILLS_DIR;
  const projectSkillsDir = path.join(projectRoot, 'skills');
  const globalSkillsDir = path.join(os.homedir(), '.claude', 'skills');

  // Order matters: first registration wins. Agent overrides bundled overrides global.
  scanCategorizedDirectory(agentRoot, 'agent');
  scanFlatDirectory(projectSkillsDir, 'bundled');
  scanFlatDirectory(globalSkillsDir, 'global');

  logger.info({ count: skills.size, agentRoot }, 'Skill registry initialized');
}

/**
 * Re-scan all three roots using the overrides from the last init call.
 * Called by skill_manage after every write so the agent sees its own
 * changes within the same session — no process restart.
 */
export function reloadSkillRegistry(): void {
  initSkillRegistry(lastOverrides.projectRootOverride, lastOverrides.agentSkillsDirOverride);
}

/**
 * Return a compact index of all skills, one line per skill.
 * Format: "skill_id: description"
 */
export function getSkillIndex(): string {
  return Array.from(skills.values())
    .map((s) => `${s.id}: ${s.description}`)
    .join('\n');
}

/**
 * Find skills whose trigger words appear in the message.
 */
export function matchSkills(message: string): SkillMeta[] {
  const lower = message.toLowerCase();
  const matched: SkillMeta[] = [];

  for (const skill of skills.values()) {
    for (const trigger of skill.triggerWords) {
      if (lower.includes(trigger)) {
        matched.push(skill);
        break;
      }
    }
  }

  return matched;
}

/**
 * Load the full SKILL.md content for a given skill ID.
 */
export function getSkillInstructions(id: string): string | null {
  const skill = skills.get(id);
  if (!skill) return null;

  try {
    return fs.readFileSync(skill.fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Return all registered skills.
 */
export function getAllSkills(): SkillMeta[] {
  return Array.from(skills.values());
}

/**
 * Look up a skill by ID. Returns undefined if not registered.
 */
export function getSkill(id: string): SkillMeta | undefined {
  return skills.get(id);
}

/**
 * List supporting files in a skill's bundle (references/, templates/,
 * scripts/, assets/). Returns paths relative to the skill's root dir.
 * Empty array for skills without a bundle layout.
 */
export function getSkillBundleFiles(id: string): string[] {
  const skill = skills.get(id);
  if (!skill) return [];

  const root = path.dirname(skill.fullPath);
  const out: string[] = [];

  for (const sub of ['references', 'templates', 'scripts', 'assets']) {
    const subDir = path.join(root, sub);
    if (!fs.existsSync(subDir)) continue;
    try {
      const walk = (dir: string, prefix: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue;
          const full = path.join(dir, entry.name);
          const rel = path.join(prefix, entry.name);
          if (entry.isDirectory()) {
            walk(full, rel);
          } else if (entry.isFile()) {
            out.push(rel);
          }
        }
      };
      walk(subDir, sub);
    } catch {
      // Skip unreadable directories.
    }
  }

  return out;
}
