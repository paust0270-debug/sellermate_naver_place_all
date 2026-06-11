# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Rank check (integrates with unified orchestrator)
npx tsx coupang-check/coupang-rank-processor.ts --once        # paid slots, single row
npx tsx coupang-check/coupang-rank-processor.ts --free-only   # free slots

# Cart traffic — packet method (접근 A)
npx tsx coupang-check/cart-traffic-runner.ts                  # dry-run (plan only, no browser)
npx tsx coupang-check/cart-traffic-runner.ts --commit --limit=5
npx tsx coupang-check/cart-traffic-runner.ts --commit --no-write  # fire packets, skip DB counters

# Diagnostics
npx tsx coupang-check/cart-diagnose.ts "<상품 URL>"           # stale ID check (stored vs live)
npx tsx coupang-check/cart-click-poc.ts "<상품 URL>"          # real button click + RET9999/page-DOM check
npx tsx coupang-check/cart-inpage-poc.ts "<상품 URL>"         # in-page window.fetch add-cart check
npx tsx coupang-check/cart-cookie-lifespan.ts "<URL>" [--max=300] [--delay=400]
npx tsx coupang-check/cart-packet-poc.ts "<URL>"              # PoC: single harvest+fire

# Packet capture (manual click capture)
coupang-check\capture-cart.bat   # or: npx tsx coupang-check/capture-cart-packet.ts
```

## Module Map

| File | Purpose |
|------|---------|
| `coupang-rank-processor.ts` | Main rank checker (~2200 lines). Paid + free keyword modes. Also performs browser-based cart add during rank pass. |
| `cart-packet-lib.ts` | Shared library: `harvestCookies`, `addCart`, `addCartRetry`, `cartCount`, `parseProduct`. |
| `cart-traffic-runner.ts` | Table-driven cart traffic runner. Reads `sellermate_slot_coupang`, fires add-cart packets, updates daily/total counters. |
| `cart-diagnose.ts` | Compares stored `itemId`/`vendorItemId` vs live page values; fires both to identify stale-ID failures. |
| `cart-click-poc.ts` | Opens product page, clicks the real cart button if present, and reports add-cart responses/page blockers. |
| `cart-inpage-poc.ts` | Calls add-cart with `window.fetch` inside the product page to separate browser-context vs payload failures. |
| `cart-cookie-lifespan.ts` | Measures how many sequential add-cart calls succeed before a cookie set goes stale/blocked. |
| `cart-packet-poc.ts` | PoC script that proved the harvest-then-fetch approach (not a production runner). |
| `capture-cart-packet.ts` | Network listener tool: user clicks "장바구니 담기" manually in launched browser; dumps all XHR/fetch requests. |
| `captures/` | Dumped captures (raw with cookies + `-safe.json` masked). All gitignored. |

## Architecture

### Two Cart-Traffic Approaches (in transition)

**Current (browser-based):** `coupang-rank-processor.ts:454–554` adds to cart inside the rank-check browser session (non-logged-in, patchright + system Chrome). Runs during each rank check pass.

**New (packet-based, 접근 A):** `cart-traffic-runner.ts` + `cart-packet-lib.ts`. Harvest Akamai cookies once with a browser visit, then fire `POST /next-api/order/add-cart` via plain `fetch` for all slots — no second browser needed per slot. Validated: `sdpVisitKey` can be empty; `_abck` cookie must reach `~0~` validation state before firing.

The packet method is the **target architecture** for dedicated cart traffic. See `../BRIEFING-coupang-cart-traffic.md` and the `coupang-cart-traffic` skill for migration context.

### Verification Status & Windows Handoff (updated 2026-06-11)

**The packet version is code-complete but NOT yet live-verified end-to-end.** A successful real add-cart (`resultCode:"OK"`) from the node-`fetch` packet has never been recorded. The `captures/*.json` files are manual-browser-click network dumps used to reverse-engineer the payload — they are NOT proof the packet method fires successfully.

**Verified on 2026-06-11 (from WSL2):**
- ✅ **DRY-RUN passed.** `cart-traffic-runner.ts` connects to Supabase, reads `sellermate_slot_coupang` (8 active slots, 5 processable), and `parseProduct()` extracts valid `productId`/`itemId`/`vendorItemId` for every slot. Table-driven query/filter/parse logic works against live data.
- ❌ **Live packet fire NOT verified from WSL2.** Two blockers, both environmental: (1) WSL2 has no Linux Chrome, and the patchright bundled `chromium-1200` download stalled (~18 MB after 15+ min) on this throttled/blocked network; (2) the same network gave the 2026-06-10 `RET9999` IP/Akamai block. IP rotation is unavailable here (no ADB device / no tethering adapter).

**Why Windows is the right place to finish this:** `harvestCookies()` launches `channel: 'chrome'` (system Chrome) first — present on Windows, absent in WSL2 — and production runs on Windows with the traffic IP. Do the live verification on Windows, not WSL2.

**Windows continuation steps (run in order):**
1. `npx tsx coupang-check\cart-traffic-runner.ts --limit=5` — confirm DRY-RUN still lists slots (no browser/fire).
2. `npx tsx coupang-check\cart-traffic-runner.ts --commit --no-write --limit=1` — **the key test.** Harvests cookies (watch for `_abck 검증됨✅`), fires ONE packet, skips DB counters. Success = `OK✅`. If `RET9999`/`HTTP403` → IP/Akamai still blocking → rotate IP (phone tethering/ADB) and retry.
3. If 400 "잘못된 접근" → stale IDs: `npx tsx coupang-check\cart-diagnose.ts "<slot link_url>"`.
4. If a real page DOM won't load at all, sanity-check with `cart-click-poc.ts "<URL>"` first, then rerun packet tests.

**After live `OK✅` is confirmed, remaining work:** (a) wire `cart-traffic-runner.ts` into `run-unified.ts` as a cycle stage (currently standalone); (b) replace the old browser-based add-cart in `coupang-rank-processor.ts:454–554`; (c) commit the untracked `cart-*` files.

### Supabase Tables

| Table | Used by |
|-------|---------|
| `sellermate_keywords` | Rank check input queue. Atomic lock via `assigned_to = PC_ID` where `assigned_to IS NULL`. Slot types: `쿠팡`, `쿠팡VIP`, `쿠팡APP`, `쿠팡순위체크`. Free mode: rows where `free_coupang_id IS NOT NULL`. |
| `sellermate_slot_coupang` | Cart traffic slots. Tracks `daily_target / daily_success_count / daily_fail_count / daily_traffic_count / total_*`. Daily counters reset when `last_reset_date ≠ today (KST)`. |

### Product ID Extraction

Coupang URLs carry 3 IDs needed for add-cart:
- `productId` — from `/products/{id}` path segment
- `itemId` — query param (optional; absent = omit from payload)
- `vendorItemId` — query param (required for `items[]` field)

`parseProduct()` in `cart-packet-lib.ts` handles scheme-missing URLs. `hasCartIds()` gates slots missing `vendorItemId`.

### Akamai Bot Defense

`harvestCookies()` opens a browser, moves the mouse + scrolls, and waits until `_abck` cookie value contains `~0~` (validated state) before closing. Validated cookies dramatically improve add-cart success rate. If `_abck` stays unvalidated, expect elevated 400/403 rates.

### add-cart Payload Shape

```json
{
  "items[]": ["<vendorItemId>: <quantity>"],
  "clickProductId": <productId as number>,
  "landProductId": "<productId as string>",
  "sdpVisitKey": "",
  "q": "",
  "searchId": "",
  "productId": <productId as number>,
  "clickItemId": <itemId>,
  "cartItemId": <itemId>
}
```

POST to `https://www.coupang.com/next-api/order/add-cart`. Response `resultCode: "OK"` = success.

### Failure Modes

| Symptom | Likely cause | Tool |
|---------|-------------|------|
| `resultCode` 400 "잘못된 접근" | Stale `itemId`/`vendorItemId` | `cart-diagnose.ts` |
| HTTP 403 / `_abck` challenge | Cookie not validated before firing | Longer harvest wait |
| All slots fail after N successes | Cookie expired | `cart-cookie-lifespan.ts` → reharvest |
| IP-level block (reharvest also fails) | IP rate limit | IP rotation |
