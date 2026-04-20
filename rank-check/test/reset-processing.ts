#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function reset() {
  console.log('🔍 processing 상태 확인 중...\n');

  // 메인 테이블 processing 상태 조회
  const { data: processing, count, error: selectError } = await supabase
    .from('keywords_navershopping')
    .select('id, keyword, status', { count: 'exact' })
    .eq('status', 'processing');

  if (selectError) {
    console.error('조회 에러:', selectError.message);
    return;
  }

  console.log('📊 keywords_navershopping processing:', count, '개');
  processing?.slice(0, 10).forEach(p => console.log('  -', p.id, p.keyword?.substring(0, 20)));

  if (count && count > 0) {
    const { data, error } = await supabase
      .from('keywords_navershopping')
      .update({ status: 'pending' })
      .eq('status', 'processing')
      .select('id');

    if (error) {
      console.error('업데이트 에러:', error.message);
    } else {
      console.log('\n✅', data?.length, '개 pending으로 초기화 완료');
    }
  } else {
    console.log('\nprocessing 상태인 항목이 없습니다.');
  }
}

reset().catch(console.error);
