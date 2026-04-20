/**
 * 쇼핑 무료 순위만 sellermate_free_navershopping_rank_history에 저장
 * - free_navershopping_id, rank(순위 미발견 시 -1), rank_date(date)만 저장
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface SaveFreeNavershoppingResult {
  success: boolean;
  error?: string;
}

export async function saveFreeNavershoppingRankToHistory(
  supabase: SupabaseClient,
  freeNavershoppingId: number,
  rank: number | null
): Promise<SaveFreeNavershoppingResult> {
  try {
    const now = new Date();
    const rankDate = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const rankValue = rank !== null && rank >= 1 ? rank : -1;

    const { error } = await supabase.from('sellermate_free_navershopping_rank_history').insert({
      free_navershopping_id: freeNavershoppingId,
      rank: rankValue,
      rank_date: rankDate,
    });

    if (error) {
      console.warn(`   ⚠️ sellermate_free_navershopping_rank_history 저장 실패: ${error.message}`);
      return { success: false, error: error.message };
    }
    console.log(`   📊 무료 쇼핑 히스토리 저장 (free_navershopping_id: ${freeNavershoppingId}, 순위: ${rankValue === -1 ? '미발견' : rankValue})`);
    return { success: true };
  } catch (err: unknown) {
    const msg = (err as Error).message;
    console.error(`   ❌ 무료 쇼핑 히스토리 저장 에러:`, msg);
    return { success: false, error: msg };
  }
}
