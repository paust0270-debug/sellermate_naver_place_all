import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    process.exit(1);
  }
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('sellermate_keywords_navershopping')
    .select('id')
    .limit(1);
  if (error) {
    console.error('FAIL:', error.message);
    process.exit(1);
  }
  console.log('OK', data?.length ?? 0, 'row(s)');
}

main();
