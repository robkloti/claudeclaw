/**
 * Hook Intelligence module — content-performance page, Phase 5.2.
 *
 * Cross-post pattern detection. Surfaces which hook structures are
 * winning across multiple posts.
 *
 * Milestone (earned): 10+ posts logged in content/results/post-performance.md
 *                     (each "## YYYY-MM-DD" header = one post entry).
 *
 * Output: top hook patterns by avg engagement, sample hook lines per
 * pattern, anti-pattern hooks (low engagement clusters).
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
  title: string;
  format: string;
  platform: string;
  hook: string;
  metrics: string;
  what_hit: string;
  what_flopped: string;
  verdict: string;
}

function readPosts(): PostEntry[] {
  const file = path.join(gystOpsPath(), 'content', 'results', 'post-performance.md');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf-8');
  // Each post entry starts with "## YYYY-MM-DD"
  const blocks = text.split(/\n## (?=\d{4}-\d{2}-\d{2})/);
  const posts: PostEntry[] = [];
  for (const b of blocks) {
    const dateMatch = b.match(/^(\d{4}-\d{2}-\d{2})\s*[—\-–]?\s*(.*)$/m);
    if (!dateMatch) continue;
    const date = dateMatch[1];
    const titleLine = dateMatch[0];
    const get = (label: string): string => {
      const m = b.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+?)$`, 'mi'));
      return m ? m[1].trim() : '';
    };
    posts.push({
      date,
      title: titleLine,
      format: get('Format'),
      platform: get('Platform'),
      hook: get('Hook'),
      metrics: get('7-day metrics'),
      what_hit: get('What hit'),
      what_flopped: get('What flopped'),
      verdict: get('Verdict'),
    });
  }
  return posts;
}

/** Classify a hook string into a pattern bucket via simple heuristics. */
function classifyHook(hook: string): string {
  if (!hook) return 'unclassified';
  const h = hook.toLowerCase();
  if (/^(here'?s|here are)/.test(h)) return 'announcement';
  if (/^(stop|don't|never)/.test(h)) return 'imperative';
  if (/^(most people|nobody|everyone)/.test(h)) return 'contrast';
  if (/^(i (built|shipped|launched|tried|spent))/.test(h)) return 'first-person-build';
  if (/^(why|how|what|when)/.test(h)) return 'question';
  if (/^\d+\s/.test(h) || /\d+ (things|reasons|ways|tips)/.test(h)) return 'listicle';
  if (/(\$\d|\d+x|\d+%)/.test(h)) return 'numbers-receipt';
  return 'other';
}

/** Crude engagement score from the metrics free-text field. */
function engagementScore(metrics: string): number {
  if (!metrics) return 0;
  // Sum first 3 numbers found in the metrics line (likes + comments + saves typically)
  const nums = metrics.match(/\d+/g);
  if (!nums) return 0;
  return nums.slice(0, 3).reduce((s, n) => s + parseInt(n, 10), 0);
}

const hookIntelligence: ModuleDef = {
  name: 'hook-intelligence',
  display_name: 'Hook Intelligence',
  page: 'content-performance',
  preview_description: 'Cross-post pattern detection. Which hook structures are actually winning across your content?',
  tour_text: 'You\'ve shipped enough posts to find patterns. Hook Intelligence buckets your hooks by structure (listicle, imperative, contrast, etc) and tells you which patterns hit hardest.',

  evaluateMilestone: (): MilestoneState => {
    const posts = readPosts();
    const count = posts.length;
    if (count >= 10) {
      return {
        unlocked: true,
        progress_pct: 100,
        preview_text: `${count} posts logged`,
        progress_data: { post_count: count },
      };
    }
    return {
      unlocked: false,
      progress_pct: Math.min(100, Math.round((count / 10) * 100)),
      preview_text: `${count} of 10 posts`,
      progress_data: { post_count: count },
    };
  },

  classifier: (): unknown => {
    const posts = readPosts();
    if (posts.length < 3) return { post_count: posts.length, top_patterns: [], anti_patterns: [] };

    // Group by hook pattern
    const byPattern: Record<string, { count: number; total_engagement: number; sample_hooks: string[] }> = {};
    for (const p of posts) {
      const pattern = classifyHook(p.hook);
      const eng = engagementScore(p.metrics);
      const b = byPattern[pattern] || { count: 0, total_engagement: 0, sample_hooks: [] };
      b.count += 1;
      b.total_engagement += eng;
      if (b.sample_hooks.length < 3 && p.hook) b.sample_hooks.push(p.hook.slice(0, 100));
      byPattern[pattern] = b;
    }

    const ranked = Object.entries(byPattern)
      .map(([pattern, b]) => ({
        pattern,
        count: b.count,
        avg_engagement: Math.round((b.total_engagement / b.count) * 10) / 10,
        sample_hooks: b.sample_hooks,
      }))
      .filter((r) => r.count >= 2)
      .sort((a, b) => b.avg_engagement - a.avg_engagement);

    return {
      post_count: posts.length,
      top_patterns: ranked.slice(0, 5),
      anti_patterns: ranked.slice(-3).reverse(),
    };
  },
};

export default hookIntelligence;
