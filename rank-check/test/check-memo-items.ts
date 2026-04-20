#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('🔍 slot_navertest에서 memo 컬럼이 있는 항목 조회\n');

  // memo가 채워진 항목들 조회
  const { data, count, error } = await supabase
    .from('slot_navertest')
    .select('*', { count: 'exact' })
    .not('memo', 'is', null)
    .neq('memo', '')
    .order('id', { ascending: true });

  if (error) {
    console.error('에러:', error.message);
    return;
  }

  console.log(`📊 memo가 있는 항목: ${count}개\n`);

  if (data && data.length > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('ID\t\t순위\t\tkeyword\t\tmemo');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    for (const row of data) {
      console.log(`${row.id}\t\t${row.current_rank || 'N/A'}\t\t${row.keyword?.substring(0, 10) || 'N/A'}\t\t${row.memo?.substring(0, 30) || ''}`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n📋 상세 정보:');
    for (const row of data) {
      console.log(`\n[ID: ${row.id}]`);
      console.log(`  keyword: ${row.keyword}`);
      console.log(`  product_name: ${row.product_name?.substring(0, 50)}`);
      console.log(`  current_rank: ${row.current_rank || '미체크'}`);
      console.log(`  link_url: ${row.link_url?.substring(0, 60)}`);
      console.log(`  mid: ${row.mid || 'N/A'}`);
      console.log(`  memo: ${row.memo}`);
    }
  }
}

main().catch(console.error);
