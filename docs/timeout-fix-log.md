# Scheduled Task Timeout Fix Log

**Date:** 2026-06-25
**Flagged:** 4+ times. Mission 6ce9a824 created 2026-06-19 to fix this, cancelled 2026-06-25 after running 6 days without resolving.

---

## Root Cause

Tasks could get permanently stuck in `status = 'running'` when the process stayed alive but the queue callback was dropped or threw before `updateTaskAfterRun` was called.

The existing mitigation (`resetStuckTasks`) only fires at `initScheduler` (startup). So any task that got stuck mid-process-lifecycle stayed stuck until the next restart.

**Scenarios that trigger the stuck state:**

1. `runAgent` call completes but `sender()` throws before `updateTaskAfterRun` is reached, AND the `catch` block's `updateTaskAfterRun` also fails (DB blip, etc.)
2. The messageQueue callback itself is dropped by an unhandled rejection in the queue internals
3. Process receives SIGTERM while in the `try` block but after `markTaskRunning` -- DB never gets the reset

In all cases: `markTaskRunning` wrote `status = 'running'` and `started_at`, but neither the `try` nor `catch` path reached `updateTaskAfterRun`.

---

## Tasks Affected (2026-06-25 audit)

| ID | Prompt (truncated) | Issue |
|---|---|---|
| `418863d6` | TikTok affiliate shop reminder | Stuck in `running` since 09:00 today. `last_status = success` from prior run. |
| `01d0e86b` | Skill self-review | Hits 25-min timeout every run -- prompt does a full 7-day `conversation_log` read. Too much data. |
| `256bd836` | Research sweep | Disabled after timing out June 5. Correctly disabled. |
| `ac070a71` | Weekly email challenger | `last_status = NULL`, never successfully ran. Low priority. |

---

## Fix Implemented

### 1. Immediate: Manual DB reset of stuck task

```sql
UPDATE scheduled_tasks SET status = 'active', started_at = NULL WHERE id = '418863d6';
```

### 2. New DB function: `resetOverdueStuckTasks`

Added to `src/db.ts`. Resets only tasks where `started_at` is older than `maxAgeSec`, not ALL running tasks. Safe to call while tasks are actively running.

```typescript
export function resetOverdueStuckTasks(agentId: string, maxAgeSec: number): number
```

SQL logic: only resets if `(now - started_at) > maxAgeSec`. Tasks currently running within their window are untouched.

### 3. Periodic watchdog in `scheduler.ts`

Added to `initScheduler`. Runs every 30 minutes with a 35-minute stuck threshold (25-min timeout + 10-min buffer):

```typescript
const WATCHDOG_INTERVAL_MS = 30 * 60 * 1000;
const STUCK_THRESHOLD_SEC = Math.ceil(TASK_TIMEOUT_MS / 1000) + 10 * 60; // 35 min
setInterval(() => {
  const recovered = resetOverdueStuckTasks(agentId, STUCK_THRESHOLD_SEC);
  if (recovered > 0) logger.warn({ recovered }, 'Watchdog reset overdue stuck tasks');
}, WATCHDOG_INTERVAL_MS);
```

### 4. Build & deploy

```
npm run build  # succeeded
pm2 restart claudeclaw  # picks up new dist
```

---

## What This Does NOT Fix

- `01d0e86b` (skill self-review) times out because the prompt is too data-heavy. Fix: narrow the `conversation_log` query window in that task's prompt (e.g., last 24h instead of 7 days).
- `ac070a71` (weekly email challenger) never ran -- likely a HITL flow that requires manual intervention. Not a timeout issue.

---

## Files Changed

- `src/db.ts`: added `resetOverdueStuckTasks`
- `src/scheduler.ts`: imported `resetOverdueStuckTasks`, added watchdog interval
- `dist/`: rebuilt

---

## Next Steps (optional)

- Narrow `01d0e86b` skill self-review prompt to avoid recurring timeouts
- Add watchdog logging to the Telegram notification channel (currently just pino logger)
