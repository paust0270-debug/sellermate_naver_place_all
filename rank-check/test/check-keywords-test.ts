#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data, count } = await supabase
    .from('keywords_navershopping-test')
    .select('*', { count: 'exact' })
    .order('id', { ascending: false })
    .limit(5);

  console.log('=== keywords_navershopping-test ===');
  console.log('총:', count, '개\n');

  for (const row of data || []) {
    console.log(`ID ${row.id}: mid=${row.mid || 'NULL'}, product_name=${row.product_name?.substring(0, 25) || 'NULL'}, start_rank=${row.start_rank || 'NULL'}`);
  }
}

main().catch(console.error);
