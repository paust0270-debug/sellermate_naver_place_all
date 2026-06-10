# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # Install dependencies (first time)
npm start                # Run unified orchestrator (run-unified.ts)

# Run individual modules directly
npx tsx rank-check/batch/check-batch-keywords.ts --limit=5
npx tsx place-check/batch/check-place-batch.ts --limit=3
npx tsx coupang-check/coupang-rank-processor.ts --once

# Single product rank test
npx tsx rank-check/single/check-mid-rank-simple.ts "검색어" 85786220552

# Browser test
npx tsx rank-check/browser-test.ts
```

No dedicated test runner — test scripts live in `rank-check/test/` and are run directly with `npx tsx`.

## Architecture

### What This Does

Unified automation platform that monitors product rankings across Naver Shopping, Naver Place, and Coupang, and generates shopping traffic. Designed to run across multiple PCs concurrently, using Supabase as shared state with atomic locking to prevent duplicate work.

### Entry Point: `run-unified.ts`

Holds a single-process lock (`.unified-runner.lock`), then runs an infinite 7-stage cycle with 3-second intervals:

1. Naver Shopping rank check (paid) → `rank-check/batch/check-batch-keywords.ts`
2. Shopping traffic generation (paid) → `shopping-traffic/unified-runner.ts`
3. Coupang rank check (paid) → `coupang-check/coupang-rank-processor.ts`
4. Naver Place rank check (paid slots) → `place-check/batch/check-place-batch.ts --slot-only`
5. Naver Place rank check (free) → `place-check/batch/check-place-batch.ts --free-only`
6. Naver Shopping rank check (free) → `rank-check/batch/check-free-navership-batch.ts`
7. Coupang rank check (free) → `coupang-check/coupang-rank-processor.ts --free-only`

### Multi-PC Coordination

Each stage queries Supabase for unassigned rows and atomically claims them:

```sql
UPDATE table SET assigned_to = PC_ID
WHERE assigned_to IS NULL
RETURNING *;
```

`PC_ID` is set via `PC_ID` env var or auto-detected from hostname.

### Module Layout

- **`rank-check/`** — Naver Shopping rank checker. Uses dependency injection: `RankChecker` composes `INavigator`, `IProductCollector`, `ISecurityDetector`. Products are collected via `HybridProductCollector` (API + DOM fallback). MID extraction handles 5+ URL formats (`v_mid=`, `vMid=`, `product?p=`, `catalog/`, `products/`). Rank = `(page - 1) × 40 + position`.
- **`place-check/`** — Naver Place rank checker. Clears cookies after each check to prevent session leakage.
- **`coupang-check/`** — Coupang rank processor (`coupang-rank-processor.ts`, ~2200 lines).
- **`shopping-traffic/`** — Traffic generation runner for Naver Shopping SEO.
- **`ipRotation.ts`** — IP rotation via ADB (toggles mobile data) or network adapter disable/enable as fallback. Includes a recovery daemon that re-enables mobile data every 5 seconds.

### Browser Automation

- **puppeteer-real-browser** — Primary for Naver (bot evasion, headless: false)
- **patchright** — Coupang and traffic generation (Chromium-based)
- `BATCH_SIZE=2` controls parallel browser count

## Environment Variables

Required (`.env`):
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key-here
```

Key optional vars:
```
IP_ROTATION_METHOD=auto   # adb | adapter | auto | disabled
BATCH_SIZE=2              # Parallel browser count
BATCH_COOLDOWN_MS=7000    # Pause between batches
MAX_PAGES=15              # Max search pagination depth
PC_ID=MyMachine           # Auto-detected if not set
NAVER_LOGIN_ENABLED=1     # Enable Naver login for traffic
NAVER_LOGIN_ID=your-id
NAVER_LOGIN_PW=your-pw
```

## Common Issues

| Problem | Fix |
|---------|-----|
| Already running error | Delete `.unified-runner.lock` |
| CAPTCHA blocking | Increase delays; check headless: false is set |
| IP not rotating | Run `adb devices` to verify ADB connection |
| Supabase timeout | Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` |

## Documentation

Korean-language reports in the repo root explain the business logic:
- `REPORT-프로그램-구동-로직.md` — Full execution logic
- `REPORT-placerank-shoprank.md` — Service comparison
- `BRIEFING-*.md` files — Feature briefs
