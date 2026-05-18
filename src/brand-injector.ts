/**
 * Brand injector — per-instance white-label theming for the dashboard.
 *
 * Reads BRAND_CONFIG env var (path to a brand.json file). On each HTML serve,
 * applies the brand config by:
 *   1. Replacing the <title> with `${page_title_prefix} · ClaudeClaw`
 *   2. Swapping the <link rel="icon"> href to the brand favicon (if provided)
 *   3. Injecting a <style> block at end of <head> with CSS variable overrides
 *
 * Falls through unchanged when BRAND_CONFIG is missing or invalid (graceful
 * fallback to claudeclaw's default theme).
 *
 * The dashboard's existing CSS variables (web/src/styles/main.css) ARE the
 * targets — we override them. So a brand config that sets accent_color to
 * #FF6B6B causes --color-accent: #FF6B6B to win at the :root level.
 *
 * Phase 4.1 of the AI-board port. See gyst-ops/PRP-aiboard-port.md.
 */

import * as fs from 'fs';
import { readEnvFile } from './env.js';

export interface BrandConfig {
  /** Display name shown in sidebar header (e.g. "Acme Inc Ops") */
  workspace_name?: string;
  /** Prefix for page title — final: "<prefix> · ClaudeClaw" */
  page_title_prefix?: string;
  /** Hex color, e.g. "#FF6B6B" — overrides --color-accent */
  accent_color?: string;
  /** Hex color — overrides --color-accent-hover (auto-derived from accent_color if not set) */
  accent_hover_color?: string;
  /** Hex color — overrides --color-elevated (raised surface above card) */
  elevated_color?: string;
  /** Hex color — overrides --color-border-strong */
  border_strong_color?: string;
  /** Hex color — overrides --color-text-faint */
  text_faint_color?: string;
  /** Hex color — overrides --color-bg */
  bg_color?: string;
  /** Hex color — overrides --color-sidebar */
  sidebar_color?: string;
  /** Hex color — overrides --color-card */
  card_color?: string;
  /** Hex color — overrides --color-text */
  text_color?: string;
  /** Hex color — overrides --color-text-muted */
  text_muted_color?: string;
  /** Hex color — overrides --color-border */
  border_color?: string;
  /** URL to favicon (svg, png, ico). Replaces the default /favicon.svg link. */
  favicon_url?: string;
  /** URL to logo (used in sidebar — Phase 5 will wire actual logo support). */
  logo_url?: string;
  /** Custom font family for --font-sans (e.g. "Inter, system-ui, sans-serif") */
  font_sans?: string;
  /** Custom font family for --font-mono */
  font_mono?: string;
  /** Custom font family for --font-serif (Atelier-style editorial headlines) */
  font_serif?: string;
  /** Optional: a Google Fonts (or other) stylesheet URL to inject as <link rel="stylesheet"> so custom families resolve */
  font_link_url?: string;
  /** Custom font family for --font-headline (used by Anton-style display headlines) */
  font_headline?: string;
  /** Atelier-style nested schema: which mode to default to when neither localStorage nor the user has chosen */
  default_mode?: 'dark' | 'light' | 'auto';
  /** Atelier-style nested schema: per-mode color tokens. When present, frontend resolves the active mode and overrides at runtime via theme.ts. The brand-injector still writes the *default mode's* tokens server-side so the first paint matches. */
  dark?: Partial<BrandConfig>;
  light?: Partial<BrandConfig>;
  /** Optional custom domain (informational; serving via Cloudflare Tunnel is per-client manual for now) */
  custom_domain?: string;
}

let cachedConfig: BrandConfig | null = null;
let cachedConfigSource: string | null = null;

/**
 * Load the brand config from the BRAND_CONFIG env var (path to JSON).
 * Cached after first load. Returns null if env var missing, file missing,
 * or JSON invalid (logs a warning, falls back to default theme).
 */
export function loadBrandConfig(): BrandConfig | null {
  // Match claudeclaw's convention: read .env via readEnvFile (not process.env).
  // Process env wins over .env for runtime overrides.
  const env = readEnvFile(['BRAND_CONFIG']);
  const path = (process.env.BRAND_CONFIG || env.BRAND_CONFIG || '').trim();
  if (!path) {
    return null;
  }
  if (cachedConfigSource === path && cachedConfig !== null) {
    return cachedConfig;
  }
  try {
    if (!fs.existsSync(path)) {
      console.warn(`brand-injector: BRAND_CONFIG=${path} but file does not exist; falling back to default theme`);
      return null;
    }
    const raw = fs.readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as BrandConfig;
    cachedConfig = parsed;
    cachedConfigSource = path;
    return parsed;
  } catch (e) {
    console.warn(`brand-injector: failed to load BRAND_CONFIG at ${path}:`, e);
    return null;
  }
}

/**
 * Reload the brand config — useful after a hot edit during development.
 * Production: rely on the daemon restart to pick up changes.
 */
export function reloadBrandConfig(): BrandConfig | null {
  cachedConfig = null;
  cachedConfigSource = null;
  return loadBrandConfig();
}

/**
 * Apply a brand config to served HTML. Returns the HTML with overrides
 * applied. If config is null, returns the HTML unchanged.
 */
export function injectBranding(html: string, config: BrandConfig | null = loadBrandConfig()): string {
  if (!config) {
    return html;
  }

  let out = html;

  // 1. Replace <title>
  if (config.page_title_prefix) {
    const newTitle = `${config.page_title_prefix} · ClaudeClaw`;
    out = out.replace(
      /<title>[^<]*<\/title>/,
      `<title>${escapeHtml(newTitle)}</title>`,
    );
  }

  // 2. Replace favicon href
  if (config.favicon_url) {
    out = out.replace(
      /<link rel="icon"[^>]*>/,
      `<link rel="icon" href="${escapeAttr(config.favicon_url)}" />`,
    );
  }

  // 3. Inject <style> block with CSS variable overrides + optional font link at end of <head>
  const inserts: string[] = [];
  if (config.font_link_url) {
    inserts.push(
      `    <link rel="preconnect" href="https://fonts.googleapis.com">`,
      `    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
      `    <link rel="stylesheet" href="${escapeAttr(config.font_link_url)}">`,
    );
  }
  const styleBlock = buildStyleBlock(config);
  if (styleBlock) inserts.push(styleBlock);
  if (inserts.length > 0) {
    out = out.replace(/<\/head>/, `${inserts.join('\n')}\n  </head>`);
  }

  return out;
}

/**
 * Resolve the effective config for the first paint. If the config has
 * Atelier-style nested `dark`/`light` blocks, merge the chosen default
 * mode's tokens onto the top-level config so the server-side render
 * matches what the user will see before theme.ts hydrates and (optionally)
 * swaps to the user's saved mode preference. Backward compatible: configs
 * without nested blocks pass through unchanged.
 */
function resolveDefaultMode(config: BrandConfig): BrandConfig {
  if (!config.dark && !config.light) return config;
  const mode = config.default_mode === 'light' ? 'light' : 'dark';
  const block = (mode === 'light' ? config.light : config.dark) || {};
  return { ...config, ...block };
}

/**
 * Build a <style> tag with :root { --color-* overrides; } based on the
 * config. Returns empty string if no color/font overrides are set.
 */
function buildStyleBlock(rawConfig: BrandConfig): string {
  const config = resolveDefaultMode(rawConfig);
  const overrides: string[] = [];

  if (config.accent_color) {
    overrides.push(`--color-accent: ${config.accent_color};`);
    // Derive hover (slightly darker) — same logic as theme.ts shadeHex
    const hover = shadeHex(config.accent_color, -0.1);
    if (hover) overrides.push(`--color-accent-hover: ${hover};`);
    // Derive soft (with alpha)
    const soft = withAlpha(config.accent_color, 0.15);
    if (soft) overrides.push(`--color-accent-soft: ${soft};`);
  }
  if (config.bg_color) overrides.push(`--color-bg: ${config.bg_color};`);
  if (config.sidebar_color) overrides.push(`--color-sidebar: ${config.sidebar_color};`);
  if (config.card_color) overrides.push(`--color-card: ${config.card_color};`);
  if (config.text_color) overrides.push(`--color-text: ${config.text_color};`);
  if (config.text_muted_color) overrides.push(`--color-text-muted: ${config.text_muted_color};`);
  if (config.border_color) overrides.push(`--color-border: ${config.border_color};`);
  if (config.accent_hover_color) overrides.push(`--color-accent-hover: ${config.accent_hover_color};`);
  if (config.elevated_color) overrides.push(`--color-elevated: ${config.elevated_color};`);
  if (config.text_faint_color) overrides.push(`--color-text-faint: ${config.text_faint_color};`);
  if (config.border_strong_color) overrides.push(`--color-border-strong: ${config.border_strong_color};`);
  if (config.font_sans) overrides.push(`--font-sans: ${config.font_sans};`);
  if (config.font_mono) overrides.push(`--font-mono: ${config.font_mono};`);
  if (config.font_serif) overrides.push(`--font-serif: ${config.font_serif};`);
  if (config.font_headline) overrides.push(`--font-headline: ${config.font_headline};`);

  // Atelier-style nested schema → emit per-mode blocks so theme.ts can
  // toggle data-mode on <html> at runtime without re-fetching the config.
  const modeBlocks: string[] = [];
  if (rawConfig.dark || rawConfig.light) {
    for (const m of ['dark', 'light'] as const) {
      const block = rawConfig[m];
      if (!block) continue;
      const modeOverrides: string[] = [];
      if (block.accent_color) {
        modeOverrides.push(`--color-accent: ${block.accent_color};`);
        const hover = shadeHex(block.accent_color, -0.1);
        if (hover) modeOverrides.push(`--color-accent-hover: ${hover};`);
        const soft = withAlpha(block.accent_color, 0.15);
        if (soft) modeOverrides.push(`--color-accent-soft: ${soft};`);
      }
      if (block.accent_hover_color) modeOverrides.push(`--color-accent-hover: ${block.accent_hover_color};`);
      if (block.bg_color) modeOverrides.push(`--color-bg: ${block.bg_color};`);
      if (block.sidebar_color) modeOverrides.push(`--color-sidebar: ${block.sidebar_color};`);
      if (block.card_color) modeOverrides.push(`--color-card: ${block.card_color};`);
      if (block.elevated_color) modeOverrides.push(`--color-elevated: ${block.elevated_color};`);
      if (block.border_color) modeOverrides.push(`--color-border: ${block.border_color};`);
      if (block.border_strong_color) modeOverrides.push(`--color-border-strong: ${block.border_strong_color};`);
      if (block.text_color) modeOverrides.push(`--color-text: ${block.text_color};`);
      if (block.text_muted_color) modeOverrides.push(`--color-text-muted: ${block.text_muted_color};`);
      if (block.text_faint_color) modeOverrides.push(`--color-text-faint: ${block.text_faint_color};`);
      if (modeOverrides.length > 0) {
        modeBlocks.push(`      [data-mode="${m}"] {\n${modeOverrides.map((o) => '        ' + o).join('\n')}\n      }`);
      }
    }
  }

  if (overrides.length === 0 && modeBlocks.length === 0) return '';

  const lines: string[] = [
    '    <!-- brand-injector overrides (BRAND_CONFIG) -->',
    '    <style id="brand-overrides">',
  ];
  if (overrides.length > 0) {
    lines.push('      :root, [data-theme] {');
    overrides.forEach((o) => lines.push(`        ${o}`));
    lines.push('      }');
  }
  modeBlocks.forEach((b) => lines.push(b));
  lines.push('    </style>');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Color helpers (kept self-contained to avoid pulling in theme.ts which lives
// in the frontend bundle).
// ---------------------------------------------------------------------------

function shadeHex(hex: string, amount: number): string | null {
  // amount: -1 (black) to +1 (white). -0.1 = 10% darker.
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const adjust = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amount)));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(adjust(r))}${toHex(adjust(g))}${toHex(adjust(b))}`;
}

function withAlpha(hex: string, alpha: number): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/&/g, '&amp;');
}
