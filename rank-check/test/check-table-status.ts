import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
  // keywords_navershopping-test 전체 개수
  const { count: totalCount } = await supabase
    .from('keywords_navershopping-test')
    .select('*', { count: 'exact', head: true });

  console.log('📊 keywords_navershopping-test 현황:');
  console.log('   전체:', totalCount, '개');

  // 24시간 지난 것
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: expiredCount } = await supabase
    .from('keywords_navershopping-test')
    .select('*', { count: 'exact', head: true })
    .or(`last_check_date.is.null,last_check_date.lt.${twentyFourHoursAgo}`);

  console.log('   처리 대상 (24h+ 또는 미체크):', expiredCount, '개');

  // 샘플 데이터
  const { data: sample } = await supabase
    .from('keywords_navershopping-test')
    .select('id, keyword, last_check_date')
    .limit(5);

  console.log('\n📋 샘플 데이터:');
  sample?.forEach(s => console.log('   -', s.keyword, '| last_check:', s.last_check_date?.substring(0, 19)));
}

check();
