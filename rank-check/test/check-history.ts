#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('🔍 slot_navertest_history 조회\n');

  // 최근 히스토리 조회
  const { data, count, error } = await supabase
    .from('slot_navertest_history')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    console.error('에러:', error.message);

    // 테이블이 없으면 slot_naver_history 시도
    console.log('\n🔄 slot_naver_history 테이블 시도...\n');
    const { data: data2, count: count2, error: error2 } = await supabase
      .from('slot_naver_history')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(30);

    if (error2) {
      console.error('slot_naver_history 에러:', error2.message);
      return;
    }

    console.log(`📊 slot_naver_history 총 ${count2}개 레코드\n`);
    for (const row of data2 || []) {
      console.log(`[${row.created_at?.substring(0, 19)}] slot_id: ${row.slot_id}, rank: ${row.rank}, keyword: ${row.keyword?.substring(0, 15)}`);
    }
    return;
  }

  console.log(`📊 slot_navertest_history 총 ${count}개 레코드\n`);

  if (data && data.length > 0) {
    console.log('최근 30개 기록:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    for (const row of data) {
      console.log(`[${row.created_at?.substring(0, 19)}] slot_id: ${row.slot_id}, rank: ${row.rank}, keyword: ${row.keyword?.substring(0, 15)}`);
    }
  }
}

main().catch(console.error);
