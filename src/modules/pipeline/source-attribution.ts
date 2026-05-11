/**
 * Source Attribution module — pipeline page, Phase 5.3.
 *
 * Shows which scrape source (Apify Maps, Apollo, manual, etc.) produced
 * the highest-converting leads.
 *
 * Milestone: 100+ leads from 2+ distinct sources.
 */

import { ModuleDef, MilestoneState } from '../types.js';
import fs from 'fs';
import path from 'path';
import { readEnvFile } from '../../env.js';

function gystOpsPath(): string {
  const env = readEnvFile(['GYST_OPS_PATH']);
  return env.GYST_OPS_PATH || path.join(process.env.HOME || '/Users/robkloti', 'projects', 'gyst-ops');
}

interface ScoredLead {
  source: string;
  score: number;
  status: string;
}

function readScoredLeads(): ScoredLead[] {
  const dir = path.join(gystOpsPath(), 'outreach', 'data', 'scored');
  if (!fs.existsSync(dir)) return [];
  const out: ScoredLead[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.csv')) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf-8');
    const lines = text.trim().split('\n');
    if (lines.length < 2) continue;
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const sourceIdx = header.findIndex((h) => h === 'source');
    const scoreIdx = header.findIndex((h) => h === 'score' || h === 'icp_score');
    const statusIdx = header.findIndex((h) => h === 'status' || h === 'outcome');
    if (scoreIdx === -1) continue;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const score = parseFloat(cols[scoreIdx]);
      if (isNaN(score)) continue;
      out.push({
        source: sourceIdx !== -1 ? (cols[sourceIdx] || 'unknown').trim() : 'unknown',
        score,
        status: statusIdx !== -1 ? (cols[statusIdx] || '').trim() : '',
      });
    }
  }
  return out;
}

const sourceAttribution: ModuleDef = {
  name: 'source-attribution',
  display_name: 'Source Attribution',
  page: 'pipeline',
  preview_description: 'Which scrape source (Apify, Apollo, manual) produces your highest-converting leads?',
  tour_text: 'You\'ve pulled leads from enough sources that attribution becomes meaningful. Source Attribution ranks your sources by avg ICP score + booked-call rate so you stop scraping dead channels.',

  evaluateMilestone: (): MilestoneState => {
    const leads = readScoredLeads();
    const sources = new Set(leads.map((l) => l.source).filter((s) => s && s !== 'unknown'));
    if (leads.length >= 100 && sources.size >= 2) {
      return { unlocked: true, progress_pct: 100, preview_text: `${leads.length} leads / ${sources.size} sources` };
    }
    const leadsPct = Math.min(100, (leads.length / 100) * 100);
    const sourcesPct = Math.min(100, (sources.size / 2) * 100);
    return {
      unlocked: false,
      progress_pct: Math.round(Math.min(leadsPct, sourcesPct)),
      preview_text: `${leads.length} of 100 leads / ${sources.size} of 2 sources`,
    };
  },

  classifier: (): unknown => {
    const leads = readScoredLeads();
    if (!leads.length) return { source_count: 0, sources: [] };
    const bySource: Record<string, { count: number; total_score: number; booked: number }> = {};
    for (const l of leads) {
      const src = l.source || 'unknown';
      const b = bySource[src] || { count: 0, total_score: 0, booked: 0 };
      b.count += 1;
      b.total_score += l.score;
      if (/book/i.test(l.status)) b.booked += 1;
      bySource[src] = b;
    }
    const ranked = Object.entries(bySource)
      .map(([source, b]) => ({
        source,
        lead_count: b.count,
        avg_score: Math.round((b.total_score / b.count) * 100) / 100,
        booked_count: b.booked,
        booked_rate: Math.round((b.booked / b.count) * 1000) / 10,
      }))
      .sort((a, b) => b.avg_score - a.avg_score);
    return { source_count: ranked.length, sources: ranked };
  },
};

export default sourceAttribution;
