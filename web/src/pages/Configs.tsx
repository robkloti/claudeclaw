/**
 * Configs — client-facing page using Universal Diagnostic Pattern.
 *
 * Phase 4.3 stub. Verdict bar wired, lists configs from /api/configs/list,
 * shows file content from /api/configs/:key in a basic preformatted block.
 * Next iteration: Monaco editor + save endpoint with git commit.
 */

import { useState } from 'preact/hooks';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { VerdictBar } from '@/components/VerdictBar';
import { LockedModuleRail } from '@/components/LockedModuleRail';
import { UnlockedModuleSection } from '@/components/UnlockedModuleSection';
import { useFetch } from '@/lib/useFetch';
import { FileText } from 'lucide-preact';

interface ConfigEntry {
  key: string;
  label: string;
  file: string;
  path: string;
  exists: boolean;
  size: number;
  updated_at: string | null;
}

interface ConfigContentResponse {
  key: string;
  filename: string;
  path: string;
  content: string;
  updated_at: string;
}

export function Configs() {
  const list = useFetch<{ configs: ConfigEntry[] }>('/api/configs/list', 60_000);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const detail = useFetch<ConfigContentResponse>(
    selectedKey ? `/api/configs/${selectedKey}` : null,
  );

  // Verdict — "voice drift" warning if voice.md hasn't been touched in 30+ days.
  const verdict = (() => {
    const voice = list.data?.configs?.find((c) => c.key === 'voice');
    if (voice?.updated_at) {
      const daysSince = Math.floor((Date.now() - new Date(voice.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince > 30) {
        return {
          text: `Your voice rules haven't been touched in ${daysSince} days. The synth ritual has likely added deltas worth promoting to actual rules. Worth a review.`,
          tone: 'urgent' as const,
        };
      }
    }
    return {
      text: 'Configs are the files driving how your bot writes, who it targets, and how it sounds. Edit them here; changes commit to git for audit.',
      tone: 'quiet' as const,
    };
  })();

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Configs" />
      <div class="flex-1 overflow-y-auto px-6 py-4">
        <VerdictBar text={verdict.text} tone={verdict.tone} icon={<FileText size={18} />} loading={list.loading} />

        {list.error && <PageState error={list.error} />}

        {list.data?.configs && (
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <aside class="md:col-span-1">
              <ul class="space-y-1">
                {list.data.configs.map((cfg) => (
                  <li key={cfg.key}>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(cfg.key)}
                      class={[
                        'w-full text-left px-3 py-2 rounded-md text-[13px] transition-colors',
                        selectedKey === cfg.key
                          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]',
                      ].join(' ')}
                      disabled={!cfg.exists}
                    >
                      <div class="font-medium">{cfg.label}</div>
                      <div class="text-[11px] text-[var(--color-text-faint)] truncate">
                        {cfg.exists ? `${(cfg.size / 1024).toFixed(1)}kb · ${cfg.updated_at?.slice(0, 10)}` : 'missing'}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            <section class="md:col-span-2">
              {!selectedKey && (
                <PageState empty emptyTitle="Pick a config" emptyDescription="Select one of the configs to view it. Editing comes in the next iteration (Monaco editor + git-committed save)." />
              )}
              {selectedKey && detail.loading && <PageState loading />}
              {selectedKey && detail.data && (
                <div>
                  <div class="text-[11px] text-[var(--color-text-faint)] mb-2">{detail.data.path}</div>
                  <pre class="text-[12.5px] leading-relaxed font-mono text-[var(--color-text)] bg-[var(--color-card)] p-4 rounded-md border border-[var(--color-border)] overflow-x-auto whitespace-pre-wrap">
                    {detail.data.content || '(empty)'}
                  </pre>
                </div>
              )}
            </section>
          </div>
        )}

        <UnlockedModuleSection page="configs" />
        <LockedModuleRail page="configs" />
      </div>
    </div>
  );
}
