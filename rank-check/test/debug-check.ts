#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('🔍 keywords_navershopping-test 데이터 확인\n');

  // 전체 개수
  const { count } = await supabase
    .from('keywords_navershopping-test')
    .select('*', { count: 'exact', head: true });

  console.log(`총 개수: ${count}`);

  // 샘플 데이터
  const { data, error } = await supabase
    .from('keywords_navershopping-test')
    .select('id, keyword, last_check_date, current_rank')
    .limit(3);

  if (error) {
    console.error('에러:', error.message);
    return;
  }

  console.log('\n샘플 데이터:');
  console.log(JSON.stringify(data, null, 2));

  // last_check_date null 리셋
  console.log('\n🔄 last_check_date를 null로 리셋...');
  const { data: updated, error: updateError } = await supabase
    .from('keywords_navershopping-test')
    .update({ last_check_date: null })
    .not('id', 'is', null)
    .select('id');

  if (updateError) {
    console.error('업데이트 에러:', updateError.message);
  } else {
    console.log(`✅ ${updated?.length || 0}개 리셋 완료`);
  }
}

main().catch(console.error);
