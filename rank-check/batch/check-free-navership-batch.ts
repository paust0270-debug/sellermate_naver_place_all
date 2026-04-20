#!/usr/bin/env npx tsx
/**
 * 쇼핑 무료 순위체크 배치
 *
 * - sellermate_keywords_navershopping 에서 free_navershopping_id not null 로 조회
 * - 순위만 체크 (ParallelRankChecker 재사용) → sellermate_free_navershopping_rank_history 에 저장
 * - 처리 후 해당 키워드 행 삭제
 *
 * 사용법: npx tsx rank-check/batch/check-free-navership-batch.ts [--limit=N] [--once]
 */

import 'dotenv/config';
import * as os from 'os';
import { createClient } from '@supabase/supabase-js';
import { ParallelRankChecker } from '../parallel/parallel-rank-checker';
import { saveFreeNavershoppingRankToHistory } from '../utils/save-free-navership-rank';
import { TABLE_KEYWORDS } from '../config/supabase-tables';

const MAX_PAGES = 15;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 환경 변수가 필요합니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// PC 식별자 (다중 PC 실행 시 assigned_to 락용)
const PC_ID = process.env.PC_ID || process.env.COMPUTERNAME || process.env.HOSTNAME || os.hostname() || `PC-${Date.now()}`;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(): { limit: number; once: boolean } {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const once = process.argv.includes('--once');
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 10;
  return { limit: isNaN(limit) ? 10 : limit, once };
}

/** 무료 쇼핑 키워드만 조회 (assigned_to null만, 원자적 락) */
async function claimFreeKeywords(claimLimit: number): Promise<any[]> {
  const { data: available, error: selectError } = await supabase
    .from(TABLE_KEYWORDS)
    .select('id, free_navershopping_id, keyword, link_url')
    .not('free_navershopping_id', 'is', null)
    .not('keyword', 'is', null)
    .not('link_url', 'is', null)
    .is('assigned_to', null)
    .order('id', { ascending: false })
    .limit(claimLimit);

  if (selectError || !available || available.length === 0) {
    if (selectError) console.error('❌ 무료 키워드 조회 실패:', selectError.message);
    return [];
  }

  const claimed: any[] = [];
  for (const row of available) {
    const { data: updated, error: updateError } = await supabase
      .from(TABLE_KEYWORDS)
      .update({ assigned_to: PC_ID })
      .eq('id', row.id)
      .is('assigned_to', null)
      .select('id, free_navershopping_id, keyword, link_url')
      .single();
    if (!updateError && updated) claimed.push(updated);
  }
  if (claimed.length > 0) {
    console.log(`   ✅ 무료 키워드 할당: ${claimed.length}건 (${TABLE_KEYWORDS}, PC: ${PC_ID})`);
  }
  return claimed;
}

async function main() {
  const { limit, once } = parseArgs();
  const effectiveLimit = once ? Math.min(limit, 1) : limit;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🆓 쇼핑 무료 순위체크 배치');
  console.log('   sellermate_keywords_navershopping (free_navershopping_id) → sellermate_free_navershopping_rank_history');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let keywords = await claimFreeKeywords(effectiveLimit);
  if (keywords.length === 0) {
    if (once) {
      console.log('📋 처리할 무료 키워드 없음. (--once) 종료.');
      return;
    }
    console.log('📋 처리할 무료 키워드 없음. 5초 후 재시도...');
    await delay(5000);
    keywords = await claimFreeKeywords(effectiveLimit);
  }
  if (keywords.length === 0) {
    console.log('📋 처리할 무료 키워드 없음. 종료.');
    return;
  }

  const row = keywords[0];
  console.log(`\n🔍 [1/1] ${row.keyword} (free_navershopping_id: ${row.free_navershopping_id})\n`);

  const checker = new ParallelRankChecker();
  const results = await checker.checkUrls([
    { url: row.link_url, keyword: row.keyword, maxPages: MAX_PAGES },
  ]);

  const result = results[0];
  const rank = result?.rank?.totalRank ?? null;

  if (result?.rank) {
    console.log(`   순위: ${result.rank.totalRank}위 (${result.rank.isAd ? '광고' : '오가닉'})`);
  } else {
    console.log(`   순위: 미발견`);
  }

  const saveResult = await saveFreeNavershoppingRankToHistory(
    supabase,
    row.free_navershopping_id,
    rank
  );

  if (saveResult.success) {
    const { error: delErr } = await supabase.from(TABLE_KEYWORDS).delete().eq('id', row.id).eq('assigned_to', PC_ID);
    if (delErr) {
      console.warn(`   ⚠️ 키워드 삭제 실패: ${delErr.message}`);
    } else {
      console.log(`   🗑️ sellermate_keywords_navershopping에서 삭제 완료 (id: ${row.id})`);
    }
  } else {
    await supabase.from(TABLE_KEYWORDS).update({ assigned_to: null }).eq('id', row.id).eq('assigned_to', PC_ID);
  }

  if (once) {
    console.log('\n✅ (--once) 1회 처리 완료, 종료.');
    return;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
