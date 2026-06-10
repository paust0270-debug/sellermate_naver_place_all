/**
 * 테스트용 순위 체크 결과를 slot_navertest 및 slot_rank_navertest_history 테이블에 저장
 *
 * 기존 save-rank-to-slot-naver.ts와 동일한 로직, 테이블명만 변경
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface KeywordRecord {
  id: number;
  keyword: string;
  link_url: string;
  slot_id?: number | null;
  slot_sequence?: number | null;
  slot_type?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  retry_count?: number | null;
}

export interface RankResult {
  productName: string;
  mid: string;
  midSource?: string | null;
  totalRank: number;
  organicRank: number;
  page: number;
  pagePosition: number;
  isAd: boolean;
}

export interface SaveResult {
  success: boolean;
  slotNaverId?: number;
  action: 'updated' | 'created' | 'error';
  error?: string;
}

/**
 * 테스트용 순위 결과를 Supabase에 저장
 */
export async function saveRankToSlotNaverTest(
  supabase: SupabaseClient,
  keyword: KeywordRecord,
  rankResult: RankResult | null
): Promise<SaveResult> {
  try {
    const currentRank = rankResult?.totalRank ?? -1;
    const organicRank = rankResult?.organicRank ?? null;
    const isAd = rankResult?.isAd ?? false;
    const pageNumber = rankResult?.page ?? null;
    const productName = rankResult?.productName ?? null;
    const mid = typeof rankResult?.mid === 'string' && rankResult.mid.trim() ? rankResult.mid.trim() : null;
    const midSource = rankResult?.midSource ?? null;

    let slotRecord: any = null;
    const isRankNotFound = currentRank === -1;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4단계 우선순위로 slot_navertest 레코드 검색
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // ① slot_id 우선
    if (keyword.slot_id) {
      const { data, error } = await supabase
        .from('slot_navertest')
        .select('*')
        .eq('id', keyword.slot_id)
        .maybeSingle();

      if (!error && data) {
        slotRecord = data;
        console.log(`   ✅ slot_id로 매칭: ${keyword.slot_id}`);
      }
    }

    // ② slot_sequence 우선
    if (!slotRecord && keyword.slot_sequence) {
      const { data, error } = await supabase
        .from('slot_navertest')
        .select('*')
        .eq('slot_sequence', keyword.slot_sequence)
        .eq('slot_type', keyword.slot_type || '네이버test')
        .maybeSingle();

      if (!error && data) {
        slotRecord = data;
        console.log(`   ✅ slot_sequence로 매칭: ${keyword.slot_sequence}`);
      }
    }

    // ③ keyword + link_url + slot_type
    if (!slotRecord) {
      const { data, error } = await supabase
        .from('slot_navertest')
        .select('*')
        .eq('keyword', keyword.keyword)
        .eq('link_url', keyword.link_url)
        .eq('slot_type', keyword.slot_type || '네이버test')
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        slotRecord = data;
        console.log(`   ✅ keyword+url로 매칭 (레거시)`);
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 메인 테이블 UPDATE 또는 INSERT
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const now = new Date().toISOString();

    if (slotRecord) {
      const nextMid = mid ?? (typeof slotRecord.mid === 'string' && slotRecord.mid.trim() ? slotRecord.mid.trim() : null);
      if (isRankNotFound) {
        console.log(`   ⚠️ 순위권 밖(-1) - current_rank 유지, mid 보존`);
      } else {
        const { error: updateError } = await supabase
          .from('slot_navertest')
          .update({
            current_rank: currentRank,
            start_rank: slotRecord.start_rank ?? currentRank,
            keyword: keyword.keyword,
            link_url: keyword.link_url,
            mid: nextMid,
            product_name: productName,
            updated_at: now,
          })
          .eq('id', slotRecord.id);

        if (updateError) {
          throw new Error(`slot_navertest UPDATE 실패: ${updateError.message}`);
        }

        console.log(`   💾 slot_navertest 업데이트: ID ${slotRecord.id}, 순위 ${currentRank}, mid=${nextMid || 'NULL'}${midSource ? `, source=${midSource}` : ''}`);
      }
    } else if (!isRankNotFound) {
      const { data: insertedData, error: insertError } = await supabase
        .from('slot_navertest')
        .insert({
          keyword: keyword.keyword,
          link_url: keyword.link_url,
          slot_type: keyword.slot_type || '네이버test',
          slot_sequence: keyword.slot_sequence,
          customer_id: keyword.customer_id || 'test',
          customer_name: keyword.customer_name || '테스트',
          current_rank: currentRank,
          start_rank: currentRank,
          mid,
          product_name: productName,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(`slot_navertest INSERT 실패: ${insertError.message}`);
      }

      slotRecord = insertedData;
      console.log(`   ✨ slot_navertest 신규 생성: ID ${slotRecord.id}${midSource ? `, source=${midSource}` : ''}`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 히스토리 테이블 INSERT
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    if (!slotRecord) {
      console.log(`   ⚠️ slot_navertest 레코드 없음 - 히스토리 저장 스킵`);
      return {
        success: true,
        action: 'updated',
      };
    }

    const toNumber = (val: any): number | null => {
      if (val === null || val === undefined || val === '') return null;
      const num = Number(val);
      return isNaN(num) ? null : num;
    };

    const previousRank = toNumber(slotRecord.current_rank);
    const startRank = toNumber(slotRecord.start_rank) ?? currentRank;
    const rankChange =
      previousRank !== null && currentRank !== -1 ? currentRank - previousRank : null;
    const startRankDiff =
      startRank !== null && currentRank !== -1 ? currentRank - startRank : null;

    const { error: historyError } = await supabase
      .from('slot_rank_naver_test_history')
      .insert({
        slot_status_id: slotRecord.id,
        keyword: keyword.keyword,
        link_url: keyword.link_url,
        current_rank: currentRank,
        start_rank: startRank,
        previous_rank: previousRank,
        rank_change: rankChange,
        rank_diff: rankChange,
        start_rank_diff: startRankDiff,
        slot_sequence: toNumber(keyword.slot_sequence),
        slot_type: keyword.slot_type || '네이버test',
        customer_id: keyword.customer_id || 'test',
        rank_date: now,
        created_at: now,
      });

    if (historyError) {
      console.warn(`   ⚠️ 히스토리 저장 실패: ${historyError.message}`);
    } else {
      console.log(`   📊 히스토리 추가 완료`);
    }

    return {
      success: true,
      slotNaverId: slotRecord.id,
      action: slotRecord.id === keyword.slot_id ? 'updated' : 'created',
    };
  } catch (error: any) {
    console.error(`   ❌ 저장 에러:`, error.message);
    return {
      success: false,
      action: 'error',
      error: error.message,
    };
  }
}
