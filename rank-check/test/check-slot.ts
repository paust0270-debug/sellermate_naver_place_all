#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('🔍 slot_navertest 확인\n');

  const { data, count, error } = await supabase
    .from('slot_navertest')
    .select('*', { count: 'exact' })
    .eq('keyword', '장난감')
    .order('id', { ascending: true })
    .limit(10);

  if (error) {
    console.error('에러:', error.message);
    return;
  }

  console.log(`총 개수: ${count}개\n`);
  console.log('샘플 데이터:');

  for (const row of data || []) {
    console.log(`\n━━━ ID: ${row.id} ━━━`);
    console.log(`  keyword: ${row.keyword || '❌ NULL'}`);
    console.log(`  start_rank: ${row.start_rank || '❌ NULL'}`);
    console.log(`  current_rank: ${row.current_rank || '❌ NULL'}`);
    console.log(`  product_name: ${row.product_name?.substring(0, 40) || '❌ NULL'}`);
    console.log(`  mid: ${row.mid || '❌ NULL'}`);
    console.log(`  link_url: ${row.link_url?.substring(0, 60) || '❌ NULL'}`);
  }
}

main().catch(console.error);
