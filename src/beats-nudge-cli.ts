#!/usr/bin/env node
/**
 * ClaudeClaw beats nudge CLI
 *
 * Prints the build-log beats not yet marked filmed, formatted for Telegram.
 *
 * Usage:
 *   node dist/beats-nudge-cli.js /Users/robkloti/projects/caelum-ops/docs/build-log
 */
import { formatNudge, unfilmedBeats } from './beats-nudge.js';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: beats-nudge-cli <build-log-dir>');
  process.exit(1);
}

console.log(formatNudge(unfilmedBeats(dir)));
