import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function reset() {
  const { data, error } = await supabase
    .from('keywords_navershopping-test')
    .update({ last_check_date: null })
    .not('id', 'is', null)
    .select('id');

  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('✅ ' + (data?.length || 0) + '개 키워드 last_check_date 리셋 완료');
  }
}

reset();
