#!/usr/bin/env npx tsx
/**
 * Supabase 슬롯/히스토리 테이블 컬럼 확인
 * npx tsx rank-check/test/inspect-supabase-columns.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요 (.env)');
  process.exit(1);
}

const supabase = createClient(url, key);

/** 사용자가 말한 sellermate_naver_slot → 실제 DB 테이블명은 sellermate_slot_naver */
const TABLES = [
  'sellermate_slot_naver',
  'sellermate_naver_slot',
  'sellermate_slot_rank_naver_history',
];

const SLOT_TABLE = 'sellermate_slot_naver';

const WANT = [
  'mid',
  'catalog_mid',
  'channel_product_no',
  'current_rank',
  'keyword_name',
  'trade_name',
  'price',
  'review_count',
  'product_image_url',
];

async function inspectTable(table: string) {
  const { data, error } = await supabase.from(table).select('*').limit(1);

  if (error) {
    console.log(`\n❌ ${table}: ${error.message}`);
    return;
  }

  const cols = data?.[0] ? Object.keys(data[0]).sort() : [];
  console.log(`\n✅ ${table} (${cols.length} columns from sample row)`);
  console.log('   columns:', cols.join(', '));

  console.log('   required field check:');
  for (const w of WANT) {
    const has = cols.includes(w);
    console.log(`     ${has ? '✓' : '✗'} ${w}`);
  }
}

async function main() {
  console.log('Supabase:', url.replace(/https:\/\/([^.]+).*/, 'https://$1...'));
  console.log(`\n※ 슬롯 저장 대상 테이블: ${SLOT_TABLE} (sellermate_naver_slot 아님)`);
  for (const t of TABLES) {
    await inspectTable(t);
  }
}

main();
