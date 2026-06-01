#!/usr/bin/env npx tsx
/**
 * MID/catalog_mid/channel_product_no E2E 검증
 * 1) 슬롯에서 최근 순위 있는 건 조회
 * 2) ParallelRankChecker 1건 실행
 * 3) saveRankToSlotNaver 저장
 * 4) 슬롯 컬럼 재조회
 *
 * npx tsx rank-check/test/verify-mid-e2e.ts
 * npx tsx rank-check/test/verify-mid-e2e.ts --url=... --keyword=...
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { ParallelRankChecker } from '../parallel/parallel-rank-checker';
import { saveRankToSlotNaver } from '../utils/save-rank-to-slot-naver';
import { TABLE_SLOT } from '../config/supabase-tables';
import { isValidMidId } from '../utils/resolve-shopping-mid';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function parseArgs(): { url?: string; keyword?: string; slotId?: number } {
  const out: { url?: string; keyword?: string; slotId?: number } = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--url=')) out.url = arg.slice(6).replace(/^["']|["']$/g, '');
    if (arg.startsWith('--keyword=')) out.keyword = arg.slice(10).replace(/^["']|["']$/g, '');
    if (arg.startsWith('--slot-id=')) out.slotId = parseInt(arg.slice(10), 10);
  }
  return out;
}

async function pickCandidate(): Promise<{
  url: string;
  keyword: string;
  slotId: number;
  slotSequence: number | null;
}> {
  const { data, error } = await supabase
    .from(TABLE_SLOT)
    .select('id, slot_sequence, keyword_name, link_url, current_rank, mid, catalog_mid, channel_product_no')
    .eq('slot_type', '네이버쇼핑')
    .gt('current_rank', 0)
    .lte('current_rank', 200)
    .not('link_url', 'is', null)
    .like('link_url', '%/products/%')
    .not('keyword_name', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (error) throw new Error(`슬롯 조회 실패: ${error.message}`);
  if (!data?.length) throw new Error('검증용 슬롯 후보 없음 (current_rank 1~200)');

  const row = data.find((r) => r.link_url && r.keyword_name) ?? data[0];
  return {
    url: row.link_url as string,
    keyword: row.keyword_name as string,
    slotId: row.id as number,
    slotSequence: row.slot_sequence as number | null,
  };
}

async function main() {
  const args = parseArgs();
  let url = args.url;
  let keyword = args.keyword;
  let slotId = args.slotId;

  if (!url || !keyword) {
    const c = await pickCandidate();
    url = url ?? c.url;
    keyword = keyword ?? c.keyword;
    slotId = slotId ?? c.slotId;
    console.log(`📋 슬롯 후보: id=${c.slotId} seq=${c.slotSequence}`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔬 MID E2E 검증');
  console.log(`   키워드: ${keyword}`);
  console.log(`   URL: ${url}`);
  console.log(`   slot_id: ${slotId}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const checker = new ParallelRankChecker();
  const [result] = await checker.checkUrls([{ url: url!, keyword: keyword! }]);

  if (!result.rank) {
    console.error('\n❌ 순위 미발견 — 다른 키워드/URL로 재시도 필요');
    console.error(`   error: ${result.error ?? 'unknown'}`);
    process.exit(1);
  }

  const r = result.rank;
  console.log('\n✅ 순위 발견:', r.totalRank, '위');
  console.log('   mid:', r.mid);
  console.log('   catalogMid:', r.catalogMid);
  console.log('   channelProductNo:', r.channelProductNo);
  console.log('   nvMid:', r.nvMid);
  console.log('   tradeName:', r.tradeName);

  if (!isValidMidId(r.mid)) {
    console.error('❌ mid 유효하지 않음');
    process.exit(1);
  }

  const saveResult = await saveRankToSlotNaver(supabase, {
    id: 0,
    keyword: keyword!,
    link_url: url!,
    slot_id: slotId,
  }, r);

  if (!saveResult.success) {
    console.error('❌ 저장 실패:', saveResult.error);
    process.exit(1);
  }

  const { data: after, error: readErr } = await supabase
    .from(TABLE_SLOT)
    .select('id, mid, catalog_mid, channel_product_no, current_rank, trade_name, keyword_name')
    .eq('id', slotId!)
    .single();

  if (readErr || !after) {
    console.error('❌ 슬롯 재조회 실패:', readErr?.message);
    process.exit(1);
  }

  console.log('\n📦 슬롯 DB (저장 후):');
  console.log(JSON.stringify(after, null, 2));

  const okMid = isValidMidId(after.mid);
  const okCatalog = after.catalog_mid == null || isValidMidId(String(after.catalog_mid));
  const okChannel =
    after.channel_product_no == null || /^\d+$/.test(String(after.channel_product_no));

  if (!okMid) {
    console.error('\n❌ 검증 실패: mid 미저장');
    process.exit(1);
  }

  if (r.catalogMid && String(after.catalog_mid) !== String(r.catalogMid)) {
    console.warn(`⚠️ catalog_mid 불일치 기대=${r.catalogMid} 실제=${after.catalog_mid}`);
  }

  if (r.channelProductNo && String(after.channel_product_no) !== String(r.channelProductNo)) {
    console.warn(
      `⚠️ channel_product_no 불일치 기대=${r.channelProductNo} 실제=${after.channel_product_no}`
    );
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ E2E 검증 완료');
  console.log(`   mid=${after.mid}`);
  console.log(`   catalog_mid=${after.catalog_mid ?? '(null)'}`);
  console.log(`   channel_product_no=${after.channel_product_no ?? '(null)'}`);
  console.log(`   current_rank=${after.current_rank}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
