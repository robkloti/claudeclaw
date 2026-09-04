import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

import { formatNudge, isFilmedValue, parseBuildLogEntry, readBuildLog, unfilmedBeats } from './beats-nudge.js';

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'build-log');

describe('beats nudge', () => {
  it('reads only dated build-log entries, in date order', () => {
    const beats = readBuildLog(FIXTURE_DIR);
    expect(beats.map((b) => b.file)).toEqual([
      '2026-09-04-charting.md',
      '2026-09-06-first-freebie.md',
      '2026-09-08-no-marker.md',
    ]);
  });

  it('parses title, beat quote and filmed marker from the real format', () => {
    const beats = readBuildLog(FIXTURE_DIR);
    expect(beats[0]).toMatchObject({
      date: '2026-09-04',
      title: 'Charted the map',
      filmed: false,
    });
    expect(beats[0].beat).toContain('deciding what NOT to build');
    expect(beats[1]).toMatchObject({ date: '2026-09-06', title: 'First freebie by hand', filmed: true });
  });

  it('treats a missing Filmed line as not filmed', () => {
    const beats = readBuildLog(FIXTURE_DIR);
    expect(beats[2]).toMatchObject({ date: '2026-09-08', title: 'Cost ledger', filmed: false });
  });

  it('lists only the unfilmed beats', () => {
    expect(unfilmedBeats(FIXTURE_DIR).map((b) => b.date)).toEqual(['2026-09-04', '2026-09-08']);
  });

  it('recognises filmed values', () => {
    expect(isFilmedValue('yes')).toBe(true);
    expect(isFilmedValue('Yes, 2026-09-05')).toBe(true);
    expect(isFilmedValue('2026-09-05')).toBe(true);
    expect(isFilmedValue('done')).toBe(true);
    expect(isFilmedValue('no')).toBe(false);
    expect(isFilmedValue('not yet')).toBe(false);
    expect(isFilmedValue('')).toBe(false);
  });

  it('falls back to the filename when the heading is missing', () => {
    const beat = parseBuildLogEntry('2026-09-10-thing.md', '**Filmed:** no\n');
    expect(beat).toMatchObject({ date: '2026-09-10', title: '2026-09-10-thing', beat: '', filmed: false });
  });

  it('formats a Telegram-ready nudge', () => {
    const text = formatNudge(unfilmedBeats(FIXTURE_DIR));
    expect(text).toBe(
      '2 beats not yet filmed:\n' +
        '- 2026-09-04 Charted the map: "I spent an evening deciding what NOT to build. The map has more fog than tickets, and that\'s the point."\n' +
        '- 2026-09-08 Cost ledger: "Every token the worker spends now shows up on one page."',
    );
    expect(formatNudge([])).toBe('All build-log beats are filmed. Nothing to shoot this week.');
  });
});
