#!/usr/bin/env npx tsx
/**
 * MID 저장 우선순위 검증 (샘플: 특별예시 상품)
 *
 * npx tsx rank-check/test/resolve-stored-mid.test.ts
 */

import {
  resolveStoredMid,
  extractContentsIdFromAnchor,
  midSourceLabel,
} from '../utils/resolve-shopping-mid.js';

function assertEqual(name: string, actual: string | null, expected: string | null) {
  if (actual !== expected) {
    console.error(`❌ ${name}: expected ${expected}, got ${actual}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✅ ${name}: ${actual}`);
}

// 특별예시: Android 통합검색은 nv_mid=82471672138 기준
const NV_MID = '82471672138';
const CATALOG_MID = '22852058240';
const CHNL_PROD = '4927148224';

assertEqual(
  'full sample → mid is nv_mid',
  resolveStoredMid(NV_MID, NV_MID, CATALOG_MID, CHNL_PROD),
  NV_MID
);

assertEqual(
  'contentsId only (no bridge nvMid)',
  resolveStoredMid(null, NV_MID, CATALOG_MID, CHNL_PROD),
  NV_MID
);

assertEqual(
  'catalog_nv_mid fallback when no nv_mid/contentsId',
  resolveStoredMid(null, null, CATALOG_MID, CHNL_PROD),
  CATALOG_MID
);

assertEqual(
  'productId last fallback',
  resolveStoredMid(null, null, null, CHNL_PROD),
  CHNL_PROD
);

assertEqual(
  'contentsId from anchor (type=nv_mid)',
  extractContentsIdFromAnchor('nv_mid', NV_MID),
  NV_MID
);

assertEqual(
  'contentsId from anchor (10+ digits, any type)',
  extractContentsIdFromAnchor('other', NV_MID),
  NV_MID
);

const stored = resolveStoredMid(NV_MID, NV_MID, CATALOG_MID, CHNL_PROD);
const source = midSourceLabel(stored, NV_MID, NV_MID, CATALOG_MID, CHNL_PROD);
assertEqual('midSource for sample', source, 'nv_mid');

console.log('\n📦 예상 DB payload (샘플):');
console.log(
  JSON.stringify(
    {
      mid: stored,
      catalog_mid: CATALOG_MID,
      channel_product_no: CHNL_PROD,
    },
    null,
    2
  )
);

if (process.exitCode === 1) {
  console.error('\n테스트 실패');
  process.exit(1);
}
console.log('\n모든 테스트 통과');
