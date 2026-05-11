/**
 * Cross-Platform Performance module — content-performance page, Phase 5.3.
 *
 * Side-by-side comparison: same hook, different platforms. Surfaces which
 * platforms reward which content patterns.
 *
 * Milestone: 5+ posts on 2+ platforms.
 */

import { ModuleDef, MilestoneState } from '../types.js';
import fs from 'fs';
import path from 'path';
import { readEnvFile } from '../../env.js';

function gystOpsPath(): string {
  const env = readEnvFile(['GYST_OPS_PATH']);
  return env.GYST_OPS_PATH || path.join(process.env.HOME || '/Users/robkloti', 'projects', 'gyst-ops');
}

interface PostEntry {
  date: string;
  platform: string;
  format: string;
  metrics: string;
}

function readPosts(): PostEntry[] {
  const file = path.join(gystOpsPath(), 'content', 'results', 'post-performance.md');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf-8');
  const blocks = text.split(/\n## (?=\d{4}-\d{2}-\d{2})/);
  const posts: PostEntry[] = [];
  for (const b of blocks) {
    const m = b.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!m) continue;
    const get = (label: string): string => {
      const r = b.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+?)$`, 'mi'));
      return r ? r[1].trim() : '';
    };
    posts.push({ date: m[1], platform: get('Platform'), format: get('Format'), metrics: get('7-day metrics') });
  }
  return posts;
}

function engagementScore(metrics: string): number {
  if (!metrics) return 0;
  const nums = metrics.match(/\d+/g);
  if (!nums) return 0;
  return nums.slice(0, 3).reduce((s, n) => s + parseInt(n, 10), 0);
}

const crossPlatformPerformance: ModuleDef = {
  name: 'cross-platform-performance',
  display_name: 'Cross-Platform Performance',
  page: 'content-performance',
  preview_description: 'Same content, different platforms. Which platforms reward which patterns?',
  tour_text: 'You\'ve posted across enough platforms to compare them head-to-head. Cross-Platform Performance shows where each format type lands hardest.',

  evaluateMilestone: (): MilestoneState => {
    const posts = readPosts();
    const platforms = new Set(posts.map((p) => p.platform).filter(Boolean));
    if (posts.length >= 5 && platforms.size >= 2) {
      return { unlocked: true, progress_pct: 100, preview_text: `${posts.length} posts / ${platforms.size} platforms` };
    }
    const postsPct = Math.min(100, (posts.length / 5) * 100);
    const platsPct = Math.min(100, (platforms.size / 2) * 100);
    return {
      unlocked: false,
      progress_pct: Math.round(Math.min(postsPct, platsPct)),
      preview_text: `${posts.length} of 5 posts / ${platforms.size} of 2 platforms`,
    };
  },

  classifier: (): unknown => {
    const posts = readPosts();
    if (!posts.length) return { platform_count: 0, platforms: [] };
    const byPlatform: Record<string, { count: number; total_engagement: number; formats: Set<string> }> = {};
    for (const p of posts) {
      const plat = p.platform || 'unknown';
      const b = byPlatform[plat] || { count: 0, total_engagement: 0, formats: new Set() };
      b.count += 1;
      b.total_engagement += engagementScore(p.metrics);
      if (p.format) b.formats.add(p.format);
      byPlatform[plat] = b;
    }
    const ranked = Object.entries(byPlatform)
      .map(([platform, b]) => ({
        platform,
        post_count: b.count,
        avg_engagement: Math.round((b.total_engagement / b.count) * 10) / 10,
        format_diversity: b.formats.size,
        formats: Array.from(b.formats),
      }))
      .sort((a, b) => b.avg_engagement - a.avg_engagement);
    return { platform_count: ranked.length, platforms: ranked };
  },
};

export default crossPlatformPerformance;
