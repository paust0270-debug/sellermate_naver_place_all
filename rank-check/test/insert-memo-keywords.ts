#!/usr/bin/env npx tsx
/**
 * memo가 있는 slot_navertest 항목들을 keywords_navershopping-test에 추가
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('🔍 memo가 있는 slot_navertest 조회...\n');

  // memo가 있고 keyword/link_url이 있는 슬롯들 조회
  const { data: slots, error } = await supabase
    .from('slot_navertest')
    .select('*')
    .not('memo', 'is', null)
    .neq('memo', '')
    .not('keyword', 'is', null)
    .not('link_url', 'is', null)
    .order('id');

  if (error) {
    console.error('에러:', error.message);
    return;
  }

  console.log(`📊 memo가 있는 슬롯: ${slots?.length}개\n`);

  if (!slots || slots.length === 0) {
    console.log('처리할 슬롯이 없습니다.');
    return;
  }

  // keyword가 있는 슬롯만 필터링
  const validSlots = slots.filter(s => s.keyword && s.link_url);
  console.log(`유효한 슬롯: ${validSlots.length}개\n`);

  // 각 슬롯에 대해 keywords 테이블에 추가
  const keywords = validSlots.map(slot => ({
    keyword: slot.keyword,
    link_url: slot.link_url,
    slot_id: slot.id,
    slot_type: '네이버test',
  }));

  console.log('추가할 키워드:');
  keywords.forEach(k => console.log(`  - slot_id: ${k.slot_id} | ${k.keyword}`));

  // 기존 키워드 삭제 후 새로 추가
  console.log('\n🗑️  기존 keywords_navershopping-test 비우기...');
  const { error: deleteError } = await supabase
    .from('keywords_navershopping-test')
    .delete()
    .not('id', 'is', null);

  if (deleteError) {
    console.error('삭제 실패:', deleteError.message);
    return;
  }

  console.log('✨ 새 키워드 추가 중...');
  const { data: inserted, error: insertError } = await supabase
    .from('keywords_navershopping-test')
    .insert(keywords)
    .select();

  if (insertError) {
    console.error('추가 실패:', insertError.message);
    return;
  }

  console.log(`\n✅ ${inserted?.length}개 키워드 추가 완료!`);
  console.log('이제 순위 체크를 실행하세요:');
  console.log('  npx tsx rank-check/test/check-batch-worker-pool-test.ts --workers=4');
}

main().catch(console.error);
