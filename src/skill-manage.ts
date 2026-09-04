/**
 * skill_manage — agent-callable tool for writing, patching, and archiving
 * SKILL.md files in the agent-writable root (CLAUDECLAW_SKILLS_DIR).
 *
 * Hermes-parity API. Six actions:
 *   create       — write a new SKILL.md
 *   patch        — token-efficient targeted edit (old_string → new_string)
 *   edit         — full-content replacement
 *   delete       — soft delete (move to .archive/, never hard-delete)
 *   write_file   — write a supporting file inside the skill bundle
 *   remove_file  — remove a supporting file from the skill bundle
 *
 * Every successful write triggers reloadSkillRegistry() so the next user
 * message sees the change without a process restart. Matches Hermes's
 * hot-reload guarantee.
 */

import fs from 'fs';
import path from 'path';

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { CLAUDECLAW_SKILLS_ARCHIVE, CLAUDECLAW_SKILLS_DIR } from './config.js';
import {
  setSkillState,
  upsertSkillLifecycle,
} from './db.js';
import { logger } from './logger.js';
import {
  getAllSkills,
  getSkill,
  reloadSkillRegistry,
} from './skill-registry.js';

// ── Path resolution ─────────────────────────────────────────────────

const SAFE_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DEFAULT_CATEGORY = 'uncategorized';
const ALLOWED_BUNDLE_DIRS = new Set(['references', 'templates', 'scripts', 'assets']);

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function err(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Resolve where a skill should live on disk. If the skill already exists,
 * returns its current path. If new, places it under the requested category.
 * Returns absolute paths only.
 */
function resolveSkillDir(name: string, category?: string): {
  skillDir: string;
  category: string;
  isNew: boolean;
} {
  const existing = getSkill(name);
  if (existing && existing.source === 'agent') {
    return {
      skillDir: path.dirname(existing.fullPath),
      category: existing.category,
      isNew: false,
    };
  }
  const cat = (category && SAFE_NAME_REGEX.test(category)) ? category : DEFAULT_CATEGORY;
  return {
    skillDir: path.join(CLAUDECLAW_SKILLS_DIR, cat, name),
    category: cat,
    isNew: true,
  };
}

/** Reject any path that escapes the skill's own directory. */
function isSafeBundlePath(skillDir: string, requested: string): boolean {
  if (requested.startsWith('/') || requested.includes('..')) return false;

  const firstSeg = requested.split('/')[0];
  if (!ALLOWED_BUNDLE_DIRS.has(firstSeg)) return false;

  const resolved = path.resolve(skillDir, requested);
  const skillRoot = path.resolve(skillDir);
  return resolved.startsWith(skillRoot + path.sep);
}

/**
 * Reject a write whose name collides with a bundled or global skill.
 * The agent must not silently shadow project-shipped skills.
 */
function checkCollision(name: string): string | null {
  const existing = getSkill(name);
  if (!existing) return null;
  if (existing.source === 'agent') return null;
  return `A ${existing.source} skill named "${name}" already exists at ${existing.fullPath}. `
    + 'Pick a different name to avoid shadowing.';
}

// ── Action handlers ─────────────────────────────────────────────────

async function handleCreate(args: {
  name: string;
  content: string;
  category?: string;
}): Promise<ToolResult> {
  if (!SAFE_NAME_REGEX.test(args.name)) {
    return err(`Invalid skill name "${args.name}". Use lowercase letters, digits, _ and - only.`);
  }

  const collision = checkCollision(args.name);
  if (collision) return err(collision);

  const { skillDir, category, isNew } = resolveSkillDir(args.name, args.category);
  if (!isNew) {
    return err(`Skill "${args.name}" already exists. Use action=patch or action=edit to modify.`);
  }

  try {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), args.content, 'utf-8');
    upsertSkillLifecycle(args.name, 'agent');
    reloadSkillRegistry();
    logger.info({ name: args.name, category, skillDir }, 'Agent created new skill');
    return ok(
      `Created skill "${args.name}" under category "${category}". `
      + `Path: ${path.join(skillDir, 'SKILL.md')}`,
    );
  } catch (e) {
    return err(`Failed to write skill: ${(e as Error).message}`);
  }
}

async function handlePatch(args: {
  name: string;
  old_string: string;
  new_string: string;
}): Promise<ToolResult> {
  const skill = getSkill(args.name);
  if (!skill) return err(`Unknown skill "${args.name}".`);
  if (skill.source !== 'agent') {
    return err(`Cannot modify "${skill.source}" skill "${args.name}". Bundled/global skills are read-only.`);
  }

  try {
    const current = fs.readFileSync(skill.fullPath, 'utf-8');
    if (!current.includes(args.old_string)) {
      return err('old_string not found in SKILL.md. Read the file first to get the exact text.');
    }
    const occurrences = current.split(args.old_string).length - 1;
    if (occurrences > 1) {
      return err(
        `old_string appears ${occurrences} times. Provide more context so the match is unique.`,
      );
    }
    const updated = current.replace(args.old_string, args.new_string);
    fs.writeFileSync(skill.fullPath, updated, 'utf-8');
    reloadSkillRegistry();
    logger.info({ name: args.name }, 'Agent patched skill');
    return ok(`Patched skill "${args.name}".`);
  } catch (e) {
    return err(`Failed to patch skill: ${(e as Error).message}`);
  }
}

async function handleEdit(args: { name: string; content: string }): Promise<ToolResult> {
  const skill = getSkill(args.name);
  if (!skill) return err(`Unknown skill "${args.name}".`);
  if (skill.source !== 'agent') {
    return err(`Cannot modify "${skill.source}" skill "${args.name}". Bundled/global skills are read-only.`);
  }

  try {
    fs.writeFileSync(skill.fullPath, args.content, 'utf-8');
    reloadSkillRegistry();
    logger.info({ name: args.name }, 'Agent edited skill');
    return ok(`Edited skill "${args.name}".`);
  } catch (e) {
    return err(`Failed to edit skill: ${(e as Error).message}`);
  }
}

async function handleDelete(args: { name: string }): Promise<ToolResult> {
  const skill = getSkill(args.name);
  if (!skill) return err(`Unknown skill "${args.name}".`);
  if (skill.source !== 'agent') {
    return err(`Cannot delete "${skill.source}" skill "${args.name}". Bundled/global skills are read-only.`);
  }

  try {
    fs.mkdirSync(CLAUDECLAW_SKILLS_ARCHIVE, { recursive: true });
    const srcDir = path.dirname(skill.fullPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destDir = path.join(CLAUDECLAW_SKILLS_ARCHIVE, `${args.name}-${stamp}`);
    fs.renameSync(srcDir, destDir);
    setSkillState(args.name, 'archived', 'soft-deleted by agent');
    reloadSkillRegistry();
    logger.info({ name: args.name, destDir }, 'Agent archived skill');
    return ok(`Archived skill "${args.name}" to ${destDir}. Restore via skills-cli.`);
  } catch (e) {
    return err(`Failed to delete skill: ${(e as Error).message}`);
  }
}

async function handleWriteFile(args: {
  name: string;
  file_path: string;
  file_content: string;
}): Promise<ToolResult> {
  const skill = getSkill(args.name);
  if (!skill) return err(`Unknown skill "${args.name}".`);
  if (skill.source !== 'agent') {
    return err(`Cannot modify "${skill.source}" skill "${args.name}". Bundled/global skills are read-only.`);
  }

  const skillDir = path.dirname(skill.fullPath);
  if (!isSafeBundlePath(skillDir, args.file_path)) {
    return err(
      'file_path must be relative and start with references/, templates/, scripts/, or assets/. No "..".',
    );
  }

  try {
    const full = path.resolve(skillDir, args.file_path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, args.file_content, 'utf-8');
    logger.info({ name: args.name, file_path: args.file_path }, 'Agent wrote bundle file');
    return ok(`Wrote ${args.file_path} in skill "${args.name}".`);
  } catch (e) {
    return err(`Failed to write bundle file: ${(e as Error).message}`);
  }
}

async function handleRemoveFile(args: {
  name: string;
  file_path: string;
}): Promise<ToolResult> {
  const skill = getSkill(args.name);
  if (!skill) return err(`Unknown skill "${args.name}".`);
  if (skill.source !== 'agent') {
    return err(`Cannot modify "${skill.source}" skill "${args.name}". Bundled/global skills are read-only.`);
  }

  const skillDir = path.dirname(skill.fullPath);
  if (!isSafeBundlePath(skillDir, args.file_path)) {
    return err('file_path must be relative and inside references/, templates/, scripts/, or assets/.');
  }

  try {
    const full = path.resolve(skillDir, args.file_path);
    if (!fs.existsSync(full)) return err(`No such file: ${args.file_path}`);
    fs.unlinkSync(full);
    logger.info({ name: args.name, file_path: args.file_path }, 'Agent removed bundle file');
    return ok(`Removed ${args.file_path} from skill "${args.name}".`);
  } catch (e) {
    return err(`Failed to remove bundle file: ${(e as Error).message}`);
  }
}

// ── Read-side tools (progressive disclosure) ────────────────────────

async function handleSkillsList(_args: Record<string, never>): Promise<ToolResult> {
  const all = getAllSkills();
  if (all.length === 0) return ok('No skills registered.');
  const lines = all.map((s) => {
    const cat = s.category ? `[${s.category}] ` : '';
    return `- ${s.id} ${cat}(${s.source}): ${s.description}`;
  });
  return ok(lines.join('\n'));
}

async function handleSkillView(args: { name: string }): Promise<ToolResult> {
  const skill = getSkill(args.name);
  if (!skill) return err(`Unknown skill "${args.name}".`);
  try {
    const content = fs.readFileSync(skill.fullPath, 'utf-8');
    return ok(content);
  } catch (e) {
    return err(`Failed to read skill: ${(e as Error).message}`);
  }
}

// ── MCP server export ───────────────────────────────────────────────

export function buildSkillManageMcpServer() {
  return createSdkMcpServer({
    name: 'claudeclaw-skills',
    version: '1.0.0',
    tools: [
      tool(
        'skill_manage',
        [
          'Manage agent-created skills (write/patch/edit/delete/write_file/remove_file).',
          'Call this after solving a non-trivial problem so the working procedure is preserved',
          'for next time. Skills live under ~/.claudeclaw/skills/ and are loaded automatically',
          'in future sessions. Hermes-parity API.',
          '',
          'WHEN to call create:',
          '  - You completed a complex task (5+ tool calls) successfully.',
          '  - You hit errors or dead ends and found the working path.',
          '  - The user corrected your approach.',
          '  - You discovered a non-trivial workflow.',
          '',
          'DO NOT call for trivial one-shot tasks, single fact lookups, or single-tool work.',
          'DO NOT save sensitive content (API keys, personal data, credentials) into a skill.',
          'If a related skill already exists, prefer action=patch over action=create.',
        ].join('\n'),
        {
          action: z.enum(['create', 'patch', 'edit', 'delete', 'write_file', 'remove_file'])
            .describe('Which operation to perform.'),
          name: z.string().describe('Skill identifier (lowercase, digits, _ and - only).'),
          content: z.string().optional().describe(
            'Full SKILL.md content. Required for create/edit; ignored otherwise.',
          ),
          category: z.string().optional().describe(
            'Subfolder under ~/.claudeclaw/skills/ (e.g. "devops", "scraping"). '
            + 'Optional; defaults to "uncategorized".',
          ),
          old_string: z.string().optional().describe(
            'Existing text to replace. Required for patch.',
          ),
          new_string: z.string().optional().describe(
            'Replacement text. Required for patch.',
          ),
          file_path: z.string().optional().describe(
            'Relative path inside the skill bundle (e.g. "references/notes.md"). '
            + 'Required for write_file/remove_file. Must begin with references/, '
            + 'templates/, scripts/, or assets/.',
          ),
          file_content: z.string().optional().describe(
            'Content for write_file. Required for write_file.',
          ),
        },
        async (args): Promise<ToolResult> => {
          switch (args.action) {
            case 'create':
              if (!args.content) return err('content is required for action=create');
              return handleCreate({
                name: args.name,
                content: args.content,
                category: args.category,
              });
            case 'patch':
              if (args.old_string === undefined || args.new_string === undefined) {
                return err('old_string and new_string are required for action=patch');
              }
              return handlePatch({
                name: args.name,
                old_string: args.old_string,
                new_string: args.new_string,
              });
            case 'edit':
              if (!args.content) return err('content is required for action=edit');
              return handleEdit({ name: args.name, content: args.content });
            case 'delete':
              return handleDelete({ name: args.name });
            case 'write_file':
              if (!args.file_path || args.file_content === undefined) {
                return err('file_path and file_content are required for action=write_file');
              }
              return handleWriteFile({
                name: args.name,
                file_path: args.file_path,
                file_content: args.file_content,
              });
            case 'remove_file':
              if (!args.file_path) {
                return err('file_path is required for action=remove_file');
              }
              return handleRemoveFile({
                name: args.name,
                file_path: args.file_path,
              });
          }
        },
      ),
      tool(
        'skills_list',
        'List all registered skills (id, category, source, description). Use before creating a skill to check for related ones.',
        {},
        handleSkillsList,
      ),
      tool(
        'skill_view',
        'Read the full SKILL.md for a given skill name. Use to study an existing skill before patching it.',
        {
          name: z.string().describe('Skill identifier.'),
        },
        handleSkillView,
      ),
    ],
  });
}

/** Exported for unit tests so the handlers can be exercised without the SDK. */
export const __test = {
  handleCreate,
  handlePatch,
  handleEdit,
  handleDelete,
  handleWriteFile,
  handleRemoveFile,
  handleSkillsList,
  handleSkillView,
  isSafeBundlePath,
  resolveSkillDir,
};
