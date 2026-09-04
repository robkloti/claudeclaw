/**
 * Beats nudge: reads a caelum-ops style build-log folder and lists the
 * beats that are not yet marked filmed.
 *
 * Build-log format (one file per day, `YYYY-MM-DD-<slug>.md`):
 *   # 2026-09-04 — Charted the map
 *   **Beat.** "..."
 *   **Filmed:** no
 *
 * A beat counts as filmed only when its `**Filmed:**` line says yes
 * (or true/done, or carries a date). A missing line means not filmed.
 */
import fs from 'fs';
import path from 'path';

export interface Beat {
  file: string;
  date: string;
  title: string;
  beat: string;
  filmed: boolean;
}

const FILE_RE = /^(\d{4}-\d{2}-\d{2})-.*\.md$/;
const FILMED_RE = /^\*\*Filmed:\*\*\s*(.*)$/im;
const BEAT_RE = /^\*\*Beat\.\*\*\s*(.*)$/im;
const TITLE_RE = /^#\s*\d{4}-\d{2}-\d{2}\s*[—–-]+\s*(.*)$/m;

export function isFilmedValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (/^(yes|y|true|done)\b/.test(v)) return true;
  return /\d{4}-\d{2}-\d{2}/.test(v);
}

export function parseBuildLogEntry(file: string, text: string): Beat {
  const date = path.basename(file).match(FILE_RE)?.[1] ?? '';
  const title = text.match(TITLE_RE)?.[1]?.trim() ?? path.basename(file, '.md');
  const beat = text.match(BEAT_RE)?.[1]?.trim() ?? '';
  const filmedLine = text.match(FILMED_RE)?.[1];
  const filmed = filmedLine !== undefined && isFilmedValue(filmedLine);
  return { file, date, title, beat, filmed };
}

export function readBuildLog(dir: string): Beat[] {
  return fs
    .readdirSync(dir)
    .filter((name) => FILE_RE.test(name))
    .sort()
    .map((name) => parseBuildLogEntry(name, fs.readFileSync(path.join(dir, name), 'utf8')));
}

export function unfilmedBeats(dir: string): Beat[] {
  return readBuildLog(dir).filter((b) => !b.filmed);
}

export function formatNudge(beats: Beat[]): string {
  if (beats.length === 0) return 'All build-log beats are filmed. Nothing to shoot this week.';
  const lines = beats.map((b) => {
    const quote = b.beat ? ` ${b.beat}` : '';
    return `- ${b.date} ${b.title}:${quote}`;
  });
  return `${beats.length} beat${beats.length === 1 ? '' : 's'} not yet filmed:\n${lines.join('\n')}`;
}
