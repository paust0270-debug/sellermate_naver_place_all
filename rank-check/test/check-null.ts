#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('=== slot_navertest 데이터 확인 ===\n');

  // 기존 데이터 샘플 (ID < 1001)
  console.log('--- 기존 데이터 샘플 (ID < 1001) ---');
  const { data: oldData } = await supabase
    .from('slot_navertest')
    .select('id, keyword, start_rank, product_name, mid')
    .lt('id', 1001)
    .order('id', { ascending: false })
    .limit(3);

  for (const row of oldData || []) {
    console.log(`ID ${row.id}: keyword=${row.keyword || 'NULL'}, start_rank=${row.start_rank || 'NULL'}, mid=${row.mid || 'NULL'}`);
  }

  // 테스트 데이터 샘플 (ID >= 1001)
  console.log('\n--- 테스트 데이터 샘플 (ID >= 1001) ---');
  const { data: newData } = await supabase
    .from('slot_navertest')
    .select('id, keyword, start_rank, product_name, mid')
    .gte('id', 1001)
    .order('id', { ascending: true })
    .limit(3);

  for (const row of newData || []) {
    console.log(`ID ${row.id}: keyword=${row.keyword || 'NULL'}, start_rank=${row.start_rank || 'NULL'}, mid=${row.mid || 'NULL'}`);
  }
}

main().catch(console.error);
