#!/usr/bin/env npx tsx
/**
 * sellermate_keywords_place → 순위 체크 → sellermate_slot_place 업데이트 + sellermate_slot_rank_place_history INSERT
 *
 * 셀러메이트 플레이스 전용 배치.
 * - 상위 20개: 하루 1회만 저장 (오늘 이미 했으면 건너뜀). 기존 더보기 로직(펼쳐서 더보기 → 키워드+더보기)
 * - 타겟 순위: 매번 체크 및 저장
 * - 검색 1개 완료 시: 쿠키·캐시 제거 → 창 닫기 → 다음 작업 (새 브라우저)
 * - IP 로테이션: 데이터 껐다 켰다, 데이터 꺼졌을 때 자동 복구
 *
 * 사용법: npx tsx place-check/batch/check-place-batch.ts [--limit=N] [--force-top20] [--once] [--slot-only] [--free-only]
 *   --force-top20: 상위 20개 목록을 오늘 이미 저장했어도 강제로 다시 수집 (목록 제거 후 재수집 시 사용)
 */
import 'dotenv/config';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// .env.local 우선 로드 (IP_ROTATION_METHOD 등)
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config();

const POLL_INTERVAL_MS = 5 * 1000; // 키워드 없을 때·배치 후 재조회 간격 5초
const BATCH_RESULT_DIR = path.join(process.cwd(), 'place-check', 'batch', 'result');
const BATCH_RESULT_FILE = path.join(BATCH_RESULT_DIR, 'last-batch-result.json');

import { createClient } from '@supabase/supabase-js';
import { connect } from 'puppeteer-real-browser';
import { checkPlaceRank, checkPlaceRankRankOnly, fetchTop20List } from '../check-place-rank-core.js';
import { saveRankToSlotPlace, saveTop20ToHistory, saveFreePlaceRankToHistory, hasTop20SavedForKeywordToday } from '../utils/save-rank-to-slot-place.js';
import { clearCookiesAndCache } from '../utils/clearCookies.js';
import { injectEvaluatePolyfill } from '../utils/humanBehavior.js';
import {
  rotateIP,
  startRecoveryDaemon,
  startPeriodicRotationDaemon,
  stopRecoveryDaemon,
  stopPeriodicRotationDaemon,
} from '../../ipRotation.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경 변수가 필요합니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// PC 식별자 (다중 PC 실행 시 assigned_to 락용)
const PC_ID = process.env.PC_ID || process.env.COMPUTERNAME || process.env.HOSTNAME || os.hostname() || `PC-${Date.now()}`;

let shouldStop = false;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(): { limit: number | null; forceTop20: boolean; once: boolean; slotOnly: boolean; freeOnly: boolean } {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const forceTop20 = process.argv.includes('--force-top20');
  const once = process.argv.includes('--once');
  const slotOnly = process.argv.includes('--slot-only');
  const freeOnly = process.argv.includes('--free-only');
  return {
    limit: limitArg ? parseInt(limitArg.split('=')[1], 10) : null,
    forceTop20,
    once,
    slotOnly,
    freeOnly,
  };
}

function setupStopHandler(): void {
  const handler = () => {
    console.log('\n⏹️ 중단 요청 수신...');
    shouldStop = true;
    stopRecoveryDaemon();
    stopPeriodicRotationDaemon();
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}

async function main() {
  const { limit, forceTop20, once, slotOnly, freeOnly } = parseArgs();

  console.log('═══════════════════════════════════════');
  console.log('  셀러메이트 플레이스 순위 체크 배치');
  console.log('  sellermate_keywords_place → sellermate_slot_rank_place_history / free_place_rank_history');
  console.log('  상위 20개: 하루 1회 | 타겟 순위: 매번');
  if (slotOnly) console.log('  📌 --slot-only: 유료(slot) 키워드만');
  if (freeOnly) console.log('  📌 --free-only: 무료 플레이스 키워드만');
  if (forceTop20) console.log('  ⚡ --force-top20: 상위 20개 강제 재수집');
  console.log('  검색 1개 완료 시: 쿠키·캐시 제거 → 창 닫기 → 다음');
  console.log('  매 루프: 키워드 조회(없으면 5초 재시도) → 처리 → 결과 출력·JSON 저장 → 5초 대기 → 재조회');
  console.log('═══════════════════════════════════════\n');

  setupStopHandler();

  // 시작 전 IP 로테이션 (데이터 껐다 켰다 - 새 IP로 시작)
  console.log('📡 시작 전 IP 로테이션 진행 중...');
  try {
    const rotResult = await rotateIP();
    if (rotResult.success && rotResult.oldIP !== rotResult.newIP) {
      console.log(`📡 IP 변경 완료: ${rotResult.oldIP} -> ${rotResult.newIP}`);
    } else if (rotResult.method === 'skipped') {
      console.log('📡 IP 로테이션 스킵 (disabled 또는 기기 없음)');
    } else {
      console.log('📡 IP 로테이션 완료 (동일 IP 또는 스킵)');
    }
  } catch (rotErr: unknown) {
    console.warn('⚠️ 시작 전 IP 로테이션 실패, 계속 진행:', (rotErr as Error).message);
  }
  console.log('');

  // 데이터 꺼졌을 때 자동 켜지는 복구 데몬
  startRecoveryDaemon();
  // 10분마다 IP 로테이션 (데이터 껐다 켰다)
  startPeriodicRotationDaemon(10);

  const processedSlotIdsThisRun = new Set<number>(); // sellermate_keywords_place 삭제 여부용
  /** 동일 키워드+URL 재작업 시 IP 로테이션(데이터 껐다 켰다)용 */
  const processedKeywordUrlThisRun = new Set<string>();

  try {
    while (!shouldStop) {
      let query = supabase
        .from('sellermate_keywords_place')
        .select('id, slot_id, keyword, link_url, slot_sequence, slot_type, customer_id, free_place_id')
        .not('keyword', 'is', null)
        .not('link_url', 'is', null)
        .is('assigned_to', null)
        .order('id', { ascending: false })
        .limit(limit ?? 100);
      if (slotOnly) {
        query = query.not('slot_id', 'is', null).is('free_place_id', null);
      } else if (freeOnly) {
        query = query.not('free_place_id', 'is', null);
      } else {
        query = query.or('slot_id.not.is.null,free_place_id.not.is.null');
      }
      const { data: fetched, error: fetchError } = await query;

      if (fetchError) {
        console.error('❌ sellermate_keywords_place 조회 실패:', fetchError.message);
        console.log(`⏳ ${POLL_INTERVAL_MS / 1000}초 후 재시도...`);
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      if (!fetched || fetched.length === 0) {
        if (once) {
          console.log('📋 처리할 항목이 없습니다. (--once) 종료.');
          return;
        }
        console.log(`📋 처리할 항목이 없습니다. ${POLL_INTERVAL_MS / 1000}초 후 키워드 재조회...`);
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      // 원자적 락: assigned_to null인 행만 본인 PC로 할당 (다른 PC 사용 중 제외)
      const keywords: typeof fetched = [];
      for (const row of fetched) {
        const { data: updated, error: updateError } = await supabase
          .from('sellermate_keywords_place')
          .update({ assigned_to: PC_ID })
          .eq('id', row.id)
          .is('assigned_to', null)
          .select('id, slot_id, keyword, link_url, slot_sequence, slot_type, customer_id, free_place_id')
          .single();
        if (!updateError && updated) keywords.push(updated);
      }

      if (keywords.length === 0) {
        if (once) {
          console.log('📋 할당 가능한 항목 없음. (--once) 종료.');
          return;
        }
        console.log(`📋 이번 조회 항목은 다른 PC에서 처리 중. ${POLL_INTERVAL_MS / 1000}초 후 재조회...`);
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      console.log(`\n📋 ${keywords.length}개 항목 처리 예정 (PC: ${PC_ID})\n`);

      let successCount = 0;
      let failCount = 0;

      // 이번 배치에서 브라우저 1개만 사용 (작업 완료 후 쿠키·캐시 초기화 → 다음 작업 시 반영)
      const { page, browser } = await connect({
        headless: false,
        turnstile: true,
      });
      await page.setViewport({ width: 1280, height: 900 });
      await injectEvaluatePolyfill(page);

      try {
        for (let i = 0; i < keywords.length; i++) {
          if (shouldStop) break;

          const kw = keywords[i];
          const keywordUrlKey = `${kw.keyword}|${kw.link_url ?? ''}`;
          const isFreePlace = kw.free_place_id != null;
          console.log(`\n[${i + 1}/${keywords.length}] ${kw.keyword} (${isFreePlace ? `free_place_id: ${kw.free_place_id}` : `slot_id: ${kw.slot_id}`})`);

          // 2번째 작업부터: 이전 작업에서 초기화한 쿠키·캐시 상태로 시작 (추가로 한 번 더 초기화)
          if (i >= 1) {
            await clearCookiesAndCache(page);
            await delay(1500);
          }

          // 동일 키워드+동일 URL 이미 작업했으면 무조건 데이터 껐다 켰다
          if (processedKeywordUrlThisRun.has(keywordUrlKey)) {
            console.log(`   📡 동일 키워드+URL 재작업 → IP 로테이션 (데이터 껐다 켰다) 필수`);
            try {
              const rotResult = await rotateIP();
              if (rotResult.success && rotResult.oldIP !== rotResult.newIP) {
                console.log(`   📡 IP 변경 완료: ${rotResult.oldIP} -> ${rotResult.newIP}`);
              } else {
                console.log(`   📡 IP 로테이션 완료`);
              }
              await delay(3000);
            } catch (rotErr: unknown) {
              console.warn(`   ⚠️ IP 로테이션 실패, 계속 진행:`, (rotErr as Error).message);
            }
          }

          if (isFreePlace) {
            // 무료 플레이스: 순위만 체크(상세 진입 없음) → sellermate_free_place_rank_history에만 저장
            // 맛집(restaurant)/일반(place)/미용실(hairshop) URL 지원, list 미발견 시 다른 list 타입 순차 재시도
            try {
              const result = await checkPlaceRankRankOnly(page, kw.link_url, kw.keyword);
              if (result) {
                console.log(`   순위: ${result.rank ?? '미발견'}, 상점명: ${result.placeName ?? '-'}`);
              } else {
                console.log(`   ⚠️ 순위 체크 실패`);
              }
              const saveResult = await saveFreePlaceRankToHistory(supabase, kw.free_place_id, result?.rank ?? null);
              if (saveResult.success) {
                successCount++;
                processedKeywordUrlThisRun.add(keywordUrlKey);
                const { error: delErr } = await supabase
                  .from('sellermate_keywords_place')
                  .delete()
                  .eq('id', kw.id)
                  .eq('assigned_to', PC_ID);
                if (delErr) {
                  console.warn(`   ⚠️ sellermate_keywords_place 삭제 실패: ${delErr.message}`);
                } else {
                  console.log(`   🗑️ sellermate_keywords_place에서 삭제 완료 (id: ${kw.id})`);
                }
              } else {
                failCount++;
              }
            } finally {
              if (i >= 1) {
                await clearCookiesAndCache(page);
              }
            }
            if (i < keywords.length - 1) {
              await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));
            }
            continue;
          }

          const { data: slotPlace } = await supabase
            .from('sellermate_slot_place')
            .select('*')
            .eq('id', kw.slot_id)
            .maybeSingle();

          if (!slotPlace) {
            console.log(`   ⚠️ sellermate_slot_place에서 slot_id ${kw.slot_id}를 찾을 수 없음, 스킵`);
            failCount++;
            continue;
          }

          try {
            // 하루 1회: 상위 20개는 키워드당 한 번만 저장 (히스토리 조회 후 이미 있으면 크롤링·저장 모두 건너뜀)
            const top20AlreadyInHistory = forceTop20 ? false : await hasTop20SavedForKeywordToday(supabase, kw.keyword);
            if (!top20AlreadyInHistory) {
              console.log('   📋 상위 20개 리스트 추출 및 저장 (이 키워드 오늘 첫 저장)...');
              const top20 = await fetchTop20List(page, kw.keyword, kw.link_url ?? undefined);
              if (top20.length > 0) {
                await saveTop20ToHistory(supabase, kw, slotPlace, top20);
              } else {
                console.log('   ⚠️ 상위 20개 추출 실패');
              }
              await delay(2000);
            } else {
              console.log('   ⏭️ 상위 20개 건너뜀 (이 키워드 오늘 이미 히스토리에 저장됨)');
            }

            // 타겟 순위 체크 및 저장
            const result = await checkPlaceRank(page, kw.link_url, kw.keyword);

            if (result) {
              console.log(`   순위: ${result.rank ?? '미발견'}, 상점명: ${result.placeName ?? '-'}, 카테고리: ${result.category ?? '-'}`);
              console.log(`   상품URL: ${kw.link_url ?? '-'}`);
              console.log(`   방문자리뷰: ${result.visitorReviewCount ?? '-'}, 블로그리뷰: ${result.blogReviewCount ?? '-'}, 별점: ${result.starRating ?? '-'}`);
            } else {
              console.log(`   ⚠️ 순위 체크 실패`);
            }

            const saveResult = await saveRankToSlotPlace(supabase, kw, slotPlace, result ?? null);

            if (saveResult.success) {
              successCount++;
              processedSlotIdsThisRun.add(kw.slot_id as number);
              processedKeywordUrlThisRun.add(keywordUrlKey);
              const { error: delErr } = await supabase
                .from('sellermate_keywords_place')
                .delete()
                .eq('id', kw.id)
                .eq('assigned_to', PC_ID);
              if (delErr) {
                console.warn(`   ⚠️ sellermate_keywords_place 삭제 실패: ${delErr.message}`);
              } else {
                console.log(`   🗑️ sellermate_keywords_place에서 삭제 완료 (id: ${kw.id})`);
              }
            } else {
              failCount++;
            }
          } finally {
            // 작업 완료 후 2번째부터 쿠키·캐시 초기화 (다음 작업에서 깨끗한 상태로 사용)
            if (i >= 1) {
              await clearCookiesAndCache(page);
            }
          }

          if (i < keywords.length - 1) {
            await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));
          }
        }
      } finally {
        await browser.close();
      }

      // 이번 배치 결과 출력
      console.log('\n═══════════════════════════════════════');
      console.log(`  이번 배치 결과: ✅ 성공 ${successCount}, ❌ 실패 ${failCount} (총 ${keywords.length}건)`);
      console.log('═══════════════════════════════════════');

      // 결과 JSON 저장
      const batchResult = {
        batchFinishedAt: new Date().toISOString(),
        successCount,
        failCount,
        totalProcessed: keywords.length,
        keywordIds: keywords.map((k) => k.id),
      };
      try {
        if (!fs.existsSync(BATCH_RESULT_DIR)) {
          fs.mkdirSync(BATCH_RESULT_DIR, { recursive: true });
        }
        fs.writeFileSync(BATCH_RESULT_FILE, JSON.stringify(batchResult, null, 2), 'utf8');
        console.log(`📄 결과 저장: ${BATCH_RESULT_FILE}`);
      } catch (writeErr: unknown) {
        console.warn('⚠️ 결과 JSON 저장 실패:', (writeErr as Error).message);
      }

      if (once) {
        console.log('✅ (--once) 1회 처리 완료, 종료.');
        break;
      }
      // 5초 대기 후 다시 키워드 조회
      console.log(`⏳ ${POLL_INTERVAL_MS / 1000}초 후 키워드 재조회...`);
      await delay(POLL_INTERVAL_MS);
    }
  } finally {
    stopRecoveryDaemon();
    stopPeriodicRotationDaemon();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
