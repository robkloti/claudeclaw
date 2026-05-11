import {
  LayoutGrid, ListTodo, Users, MessageSquare,
  Brain, Network, Activity, ShieldCheck,
  Swords,
  Settings,
  Sparkles, FileText, TrendingUp,
  Megaphone,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';

export type RouteSection = 'workspace' | 'intelligence' | 'collaborate' | 'configure';

export interface RouteDef {
  path: string;
  label: string;
  section: RouteSection;
  icon: typeof LayoutGrid;
  shortcut?: string;
  /**
   * Phase 4.2: when CLIENT_MODE=true on the server, routes flagged
   * `operatorOnly: true` are filtered out of the sidebar and command palette.
   * Backend ACL middleware in src/dashboard.ts also returns 403 for these
   * pages' API routes when in client mode.
   */
  operatorOnly?: boolean;
}

// Single source of truth for the sidebar, command palette, and router.
// Voices used to be a top-level item; it now lives under War Room as the
// "Voice config" sub-tab and is reachable via /warroom?mode=voices.
export const ROUTES: RouteDef[] = [
  { path: '/mission',    label: 'Mission Control', section: 'workspace',    icon: LayoutGrid,    shortcut: 'g m' },
  { path: '/pipeline',   label: 'Pipeline',        section: 'workspace',    icon: Activity,      shortcut: 'g p' },
  { path: '/content-performance', label: 'Content Performance', section: 'workspace', icon: TrendingUp, shortcut: 'g f' },
  { path: '/meta-ads',   label: 'Meta Ads',        section: 'workspace',    icon: Megaphone,     shortcut: 'g d' },
  { path: '/scheduled',  label: 'Scheduled',       section: 'workspace',    icon: ListTodo,      shortcut: 'g s' },
  { path: '/agents',     label: 'Agents',          section: 'workspace',    icon: Users,         shortcut: 'g a', operatorOnly: true },
  { path: '/chat',       label: 'Chat',            section: 'workspace',    icon: MessageSquare, shortcut: 'g c' },

  { path: '/opportunities', label: 'Opportunities', section: 'intelligence', icon: Sparkles,     shortcut: 'g o' },
  { path: '/memories',   label: 'Memories',        section: 'intelligence', icon: Brain,         shortcut: 'g e' },
  { path: '/hive',       label: 'Hive Mind',       section: 'intelligence', icon: Network,       shortcut: 'g h' },
  { path: '/usage',      label: 'Usage',           section: 'intelligence', icon: Activity,      shortcut: 'g u' },
  { path: '/audit',      label: 'Audit',           section: 'intelligence', icon: ShieldCheck,                     operatorOnly: true },

  { path: '/warroom',    label: 'War Room',        section: 'collaborate',  icon: Swords,        shortcut: 'g w', operatorOnly: true },

  { path: '/configs',    label: 'Configs',         section: 'configure',    icon: FileText,      shortcut: 'g g' },
  { path: '/settings',   label: 'Settings',        section: 'configure',    icon: Settings,                        operatorOnly: true },
];

/**
 * Filter routes by client mode. When the dashboard is in client mode (per
 * /api/info.client_mode), drop everything flagged operatorOnly.
 */
export function visibleRoutes(clientMode: boolean): RouteDef[] {
  if (!clientMode) return ROUTES;
  return ROUTES.filter((r) => !r.operatorOnly);
}

export const SECTION_LABEL: Record<RouteSection, string> = {
  workspace:    'Workspace',
  intelligence: 'Intelligence',
  collaborate:  'Collaborate',
  configure:    'Configure',
};

export const DEFAULT_ROUTE = '/mission';

// Lightly typed children helper for placeholder pages.
export type PageProps = { children?: ComponentChildren };
