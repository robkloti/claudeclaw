/**
 * Module registry — Phase 5.0.
 *
 * Single source of truth for what modules exist across the dashboard.
 * Modules call `registerModule(def)` at module-load time. The dashboard
 * + unlock engine read via `getModule()` and `listModules(page)`.
 *
 * Empty by default — modules are added in Phase 5.1+ when each one ships.
 */

import type { ModuleDef, ModulePage } from './types.js';

const _registry = new Map<string, ModuleDef>();

/**
 * Register a module. Idempotent — re-registering the same name overwrites
 * (useful in dev with hot reload). Returns the registered def.
 */
export function registerModule(def: ModuleDef): ModuleDef {
  if (!def.operator_gated_only && !def.evaluateMilestone) {
    throw new Error(
      `Module '${def.name}' must define evaluateMilestone OR set operator_gated_only=true`,
    );
  }
  _registry.set(def.name, def);
  return def;
}

export function getModule(name: string): ModuleDef | undefined {
  return _registry.get(name);
}

/**
 * Return all registered modules, optionally filtered by page.
 * Sorted by display_name for stable rendering.
 */
export function listModules(page?: ModulePage): ModuleDef[] {
  const all = Array.from(_registry.values());
  const filtered = page ? all.filter((m) => m.page === page) : all;
  return filtered.sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/** Unregister — useful for tests + hot reload. */
export function clearRegistry(): void {
  _registry.clear();
}
