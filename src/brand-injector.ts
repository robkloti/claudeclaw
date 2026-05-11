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

  // 3. Inject <style> block with CSS variable overrides at end of <head>
  const styleBlock = buildStyleBlock(config);
  if (styleBlock) {
    out = out.replace(/<\/head>/, `${styleBlock}\n  </head>`);
  }

  return out;
}

/**
 * Build a <style> tag with :root { --color-* overrides; } based on the
 * config. Returns empty string if no color/font overrides are set.
 */
function buildStyleBlock(config: BrandConfig): string {
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
  if (config.font_sans) overrides.push(`--font-sans: ${config.font_sans};`);
  if (config.font_mono) overrides.push(`--font-mono: ${config.font_mono};`);

  if (overrides.length === 0) return '';

  return [
    '    <!-- brand-injector overrides (BRAND_CONFIG) -->',
    '    <style id="brand-overrides">',
    '      :root, [data-theme] {',
    ...overrides.map((o) => `        ${o}`),
    '      }',
    '    </style>',
  ].join('\n');
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
