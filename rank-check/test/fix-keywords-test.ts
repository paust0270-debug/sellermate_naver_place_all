#!/usr/bin/env npx tsx
/**
 * keywords_navershopping-test에 빠진 mid, product_name, start_rank를
 * slot_navertest에서 가져와서 업데이트
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('🔧 keywords_navershopping-test 데이터 수정 시작\n');

  // 1. keywords_navershopping-test에서 mid가 NULL인 항목 조회
  const { data: keywordsData, error: fetchError } = await supabase
    .from('keywords_navershopping-test')
    .select('id, slot_id')
    .is('mid', null);

  if (fetchError) {
    console.error('조회 에러:', fetchError.message);
    return;
  }

  console.log(`📊 mid가 NULL인 항목: ${keywordsData?.length || 0}개\n`);

  if (!keywordsData || keywordsData.length === 0) {
    console.log('✅ 수정할 항목이 없습니다.');
    return;
  }

  let updatedCount = 0;

  for (const row of keywordsData) {
    // 2. slot_navertest에서 해당 slot_id의 데이터 조회
    const { data: slotData, error: slotError } = await supabase
      .from('slot_navertest')
      .select('mid, product_name, start_rank')
      .eq('id', row.slot_id)
      .single();

    if (slotError || !slotData) {
      console.log(`⚠️ slot_id ${row.slot_id} 조회 실패`);
      continue;
    }

    // 3. keywords_navershopping-test 업데이트
    const { error: updateError } = await supabase
      .from('keywords_navershopping-test')
      .update({
        mid: slotData.mid,
        product_name: slotData.product_name,
        start_rank: slotData.start_rank,
      })
      .eq('id', row.id);

    if (updateError) {
      console.log(`❌ ID ${row.id} 업데이트 실패: ${updateError.message}`);
    } else {
      updatedCount++;
    }
  }

  console.log(`\n✅ 완료: ${updatedCount}개 업데이트됨`);
}

main().catch(console.error);
