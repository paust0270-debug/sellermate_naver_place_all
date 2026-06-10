---
name: coupang-cart-traffic
description: Use when working on Coupang cart/장바구니 traffic — the add-to-cart engagement step in the Coupang rank processor, or its planned browser→packet (HTTP) migration. Triggers on "쿠팡 장바구니", "coupang cart", "장바구니 트래픽", "cart traffic", "패킷 방식", "cart packet".
---

# Coupang Cart Traffic (쿠팡 장바구니 트래픽)

Detailed reference: `BRIEFING-coupang-cart-traffic.md` (repo root). Read it before non-trivial work.

## What it is
During Coupang rank checking, the target product is **added to cart (장바구니 담기)** to create a natural engagement signal — NOT a purchase. Rank check and cart traffic run in the **same flow**. Paid mode performs the cart step; free mode (`rankOnly`) saves rank only.

## Current method — BROWSER (AS-IS)
- Engine: **patchright** + system Chrome (`chromium.launch({ headless: false, channel: 'chrome' })`, falls back to bundled Chromium).
- Code: `coupang-check/coupang-rank-processor.ts:454–554` (cart click + modal close); browser launch at `~1124–1147`.
- Flow: search → find product by ID (≤30 pages) → open product → **add-to-cart** (4 selectors: `.prod-cart-btn`, `[data-gaclick*="cart"]`, `button[data-gaclick]`, text `장바구니 담기`) → close modal → extract details → save to Supabase `sellermate_slot_rank_coupang_history`.
- Session: **not logged in**; cookies cleared each task. IP via phone tethering (`getPhoneTetheringStatus`); PCs without tethering/ADB skip Coupang.
- Cart failure is **skipped, not fatal**.

## Direction — PACKET (TO-BE, direction only)
Goal: replace the heavy browser cart step with **direct HTTP requests** for lighter/faster/parallel execution. **No captured packets or PoC yet.**

Open problems before migrating: capture the cart API endpoint; auth/session token (PCID, device id) in a non-logged-in state; required headers/cookies (UA, Referer, CSRF); bot detection / WAF; success/failure response validation; reuse tethering IP rotation.

Next steps: capture cart request (DevTools/mitmproxy) → document endpoint/headers/payload in the briefing → PoC single-product cart HTTP call → replace or option-gate the browser cart step.

## When invoked
1. Read `BRIEFING-coupang-cart-traffic.md` for full context.
2. For packet work, first confirm whether any capture/spec has been added to the briefing since (the briefing is the source of truth — update it as findings come in).
3. Keep rank-check behavior intact; the cart step is an add-on within the same processor.
