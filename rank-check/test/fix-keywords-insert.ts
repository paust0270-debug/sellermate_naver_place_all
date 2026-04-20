#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('🔄 slot_navertest → keywords_navershopping-test 동기화');

  const { data: slots, error } = await supabase
    .from('slot_navertest')
    .select('id, keyword, link_url, slot_sequence, slot_type, current_rank')
    .eq('keyword', '장난감')
    .order('id', { ascending: false })
    .limit(50);

  if (error) {
    console.error('❌ 조회 실패:', error.message);
    return;
  }

  console.log(`✅ slot_navertest에서 ${slots.length}개 조회`);

  let inserted = 0;
  for (const slot of slots) {
    const { error: insertError } = await supabase
      .from('keywords_navershopping-test')
      .insert({
        keyword: slot.keyword,
        link_url: slot.link_url,
        slot_id: slot.id,
        slot_sequence: slot.slot_sequence,
        slot_type: slot.slot_type,
        current_rank: slot.current_rank,
      });

    if (insertError) {
      console.error(`   ⚠️ INSERT 실패: ${insertError.message}`);
    } else {
      inserted++;
    }
  }

  console.log(`\n✅ keywords_navershopping-test에 ${inserted}개 INSERT 완료`);
}

main().catch(e => console.error('🚨 에러:', e));
