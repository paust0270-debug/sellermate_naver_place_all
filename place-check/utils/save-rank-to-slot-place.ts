/**
 * 플레이스 순위 체크 결과를 sellermate_slot_place 및 sellermate_slot_rank_place_history에 저장
 * - sellermate_keywords_place → sellermate_slot_place (slot_id로 조회) → sellermate_slot_rank_place_history INSERT (타겟 순위 1건)
 * - 상위 20개 순위(경쟁사분석용) → sellermate_place_competitors INSERT
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlaceRankResult, TopListItem } from '../check-place-rank-core.js';

export interface KeywordsPlaceRecord {
  id: number;
  slot_id: number;
  keyword: string;
  link_url: string;
  slot_sequence?: number | null;
  slot_type?: string | null;
  customer_id?: string | null;
}

export interface SavePlaceResult {
  success: boolean;
  error?: string;
}

function toNumber(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

export async function saveRankToSlotPlace(
  supabase: SupabaseClient,
  keywordRecord: KeywordsPlaceRecord,
  slotPlaceRecord: any,
  result: PlaceRankResult | null
): Promise<SavePlaceResult> {
  try {
    const currentRank = result?.rank ?? -1;
    const isRankNotFound = currentRank === -1;
    const now = new Date().toISOString();

    if (slotPlaceRecord && !isRankNotFound) {
      const existingStartRank = toNumber(slotPlaceRecord.start_rank);
      const updatePayload: Record<string, unknown> = {
        current_rank: String(currentRank),
        keyword: keywordRecord.keyword,
        link_url: keywordRecord.link_url,
        updated_at: now,
      };
      // 시작순위: 없을 때만 현재 순위로 저장 (한 번만 기록)
      if (existingStartRank === null) {
        updatePayload.start_rank = String(currentRank);
      }
      const { error: updateError } = await supabase
        .from('sellermate_slot_place')
        .update(updatePayload)
        .eq('id', slotPlaceRecord.id);

      if (updateError) {
        console.warn(`   ⚠️ sellermate_slot_place UPDATE 실패: ${updateError.message}`);
      }
    }

    if (!slotPlaceRecord) {
      console.log(`   ⚠️ sellermate_slot_place 레코드 없음 (slot_id: ${keywordRecord.slot_id}) - 히스토리 저장 스킵`);
      return { success: true };
    }

    const previousRank = toNumber(slotPlaceRecord.current_rank);
    const startRank = toNumber(slotPlaceRecord.start_rank) ?? (isRankNotFound ? 0 : currentRank);
    const rankChange = previousRank !== null && !isRankNotFound ? currentRank - previousRank : null;
    const startRankDiff = startRank !== null && !isRankNotFound ? currentRank - startRank : null;

    const { error: historyError } = await supabase
      .from('sellermate_slot_rank_place_history')
      .insert({
        slot_status_id: slotPlaceRecord.id,
        keyword: keywordRecord.keyword,
        link_url: keywordRecord.link_url,
        current_rank: currentRank,
        start_rank: startRank ?? 0,
        previous_rank: previousRank,
        rank_change: rankChange,
        rank_diff: rankChange,
        start_rank_diff: startRankDiff,
        slot_sequence: toNumber(keywordRecord.slot_sequence),
        slot_type: keywordRecord.slot_type || '플레이스',
        customer_id: keywordRecord.customer_id || 'master',
        rank_date: now,
        keyword_name: result?.placeName || null,
        review_count: result?.visitorReviewCount ?? null,
        star_count: result?.starRating ?? null,
        product_image_url: result?.firstImageUrl || null,
        visitor_review_count: result?.visitorReviewCount ?? null,
        blog_review_count: result?.blogReviewCount ?? null,
        category: result?.category ?? null,
      });

    if (historyError) {
      console.warn(`   ⚠️ 히스토리 저장 실패: ${historyError.message}`);
    } else {
      console.log(`   📊 히스토리 추가 (순위: ${isRankNotFound ? '미발견(-1)' : currentRank})`);
    }

    return { success: true };
  } catch (error: any) {
    console.error(`   ❌ 저장 에러:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 오늘(해당 날짜) 해당 slot_status_id에 상위 20개 저장했는지 확인 (하루 1회용)
 * 상위20개 저장 시 rank 1~20 행이 10개 이상 있음. 타겟 저장은 1건만 추가.
 */
export async function hasTop20SavedToday(
  supabase: SupabaseClient,
  slotStatusId: number
): Promise<boolean> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const { data, error } = await supabase
    .from('sellermate_slot_rank_place_history')
    .select('id')
    .eq('slot_status_id', slotStatusId)
    .gte('current_rank', 1)
    .lte('current_rank', 20)
    .gte('rank_date', todayStart)
    .lt('rank_date', todayEnd)
    .limit(15);
  if (error) return false;
  return (data?.length ?? 0) >= 10;
}

/**
 * 오늘(해당 날짜) 이 키워드로 상위 20개가 이미 경쟁사 테이블에 저장됐는지 확인 (키워드 기준 하루 1회)
 * 동일 키워드면 상위 20개는 한 번만 저장하므로, true면 크롤링·저장 모두 건너뜀.
 */
export async function hasTop20SavedForKeywordToday(
  supabase: SupabaseClient,
  keyword: string
): Promise<boolean> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const { data, error } = await supabase
    .from('sellermate_place_competitors')
    .select('id')
    .eq('keyword', keyword)
    .gte('current_rank', 1)
    .lte('current_rank', 20)
    .gte('rank_date', todayStart)
    .lt('rank_date', todayEnd)
    .limit(15);
  if (error) return false;
  return (data?.length ?? 0) >= 10;
}

/**
 * 상위 20개 목록을 경쟁사분석용 테이블 sellermate_place_competitors에 저장
 */
export async function saveTop20ToHistory(
  supabase: SupabaseClient,
  keywordRecord: KeywordsPlaceRecord,
  slotPlaceRecord: any,
  top20: TopListItem[]
): Promise<SavePlaceResult> {
  if (!slotPlaceRecord || top20.length === 0) return { success: true };
  const now = new Date().toISOString();

  for (const item of top20) {
    const { error } = await supabase.from('sellermate_place_competitors').insert({
      keyword: keywordRecord.keyword,
      rank_date: now,
      current_rank: item.rank,
      keyword_name: item.placeName,
      link_url: item.linkUrl,
      visitor_review_count: item.visitorReviewCount ?? null,
      blog_review_count: item.blogReviewCount ?? null,
      category: item.category ?? null,
    });
    if (error) {
      console.warn(`   ⚠️ [${item.rank}] ${item.placeName} 경쟁사 테이블 저장 실패: ${error.message}`);
    } else {
      console.log(`   💾 [${item.rank}] ${item.placeName} → sellermate_place_competitors`);
    }
  }
  console.log(`   📊 상위 ${top20.length}개 경쟁사분석 테이블 저장 완료`);
  return { success: true };
}

/**
 * 무료 플레이스 순위만 sellermate_free_place_rank_history에 저장
 * - free_place_id, rank(순위 미발견 시 -1), rank_date(date)만 저장
 */
export async function saveFreePlaceRankToHistory(
  supabase: SupabaseClient,
  freePlaceId: number,
  rank: number | null
): Promise<SavePlaceResult> {
  try {
    const now = new Date();
    const rankDate = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const rankValue = rank !== null && rank >= 1 ? rank : -1;

    const { error } = await supabase.from('sellermate_free_place_rank_history').insert({
      free_place_id: freePlaceId,
      rank: rankValue,
      rank_date: rankDate,
    });

    if (error) {
      console.warn(`   ⚠️ sellermate_free_place_rank_history 저장 실패: ${error.message}`);
      return { success: false, error: error.message };
    }
    console.log(`   📊 무료 플레이스 히스토리 저장 (free_place_id: ${freePlaceId}, 순위: ${rankValue === -1 ? '미발견' : rankValue})`);
    return { success: true };
  } catch (err: unknown) {
    const msg = (err as Error).message;
    console.error(`   ❌ 무료 플레이스 히스토리 저장 에러:`, msg);
    return { success: false, error: msg };
  }
}
