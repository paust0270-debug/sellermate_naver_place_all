#!/usr/bin/env npx tsx
/**
 * 테스트용 워커 풀 방식 배치 순위 체크
 *
 * keywords_navershopping-test 테이블은 status 컬럼이 없음
 * last_check_date 기준으로 처리 대상 선별
 *
 * 사용법:
 *   npx tsx rank-check/test/check-batch-worker-pool-test.ts [--workers=N] [--limit=N]
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { ParallelRankChecker, type ParallelRankResult } from '../parallel/parallel-rank-checker';
import { saveRankToSlotNaverTest, type KeywordRecord } from './save-rank-to-slot-naver-test';
import { rotateIP } from '../utils/ipRotation';
import * as fs from 'fs';
import * as os from 'os';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 설정
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const DEFAULT_WORKERS = 4;
const MAX_PAGES = parseInt(process.env.MAX_PAGES || '15', 10);

// 차단 감지 설정
const BLOCK_THRESHOLD = 5;
const IP_ROTATION_COOLDOWN_MS = 15000;

// 워커 ID 생성
const WORKER_ID = `test-${os.hostname()}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;

// Supabase 초기화
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 환경 변수가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 통계 카운터
let successCount = 0;
let failedCount = 0;
let notFoundCount = 0;
let blockedCount = 0;
let consecutiveBlocked = 0;

function parseArgs() {
  const args = process.argv.slice(2);
  let workers = DEFAULT_WORKERS;
  let limit: number | null = null;

  for (const arg of args) {
    if (arg.startsWith('--workers=')) {
      workers = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10);
    }
  }

  return { workers, limit };
}

// slot_navertest에서 저장된 MID를 URL 기준으로 캐시
async function getCachedMids(urls: string[]): Promise<Map<string, string>> {
  const midMap = new Map<string, string>();

  if (urls.length === 0) return midMap;

  const { data, error } = await supabase
    .from('slot_navertest')
    .select('link_url, mid')
    .in('link_url', urls)
    .not('mid', 'is', null);

  if (error) {
    console.warn('⚠️ MID 캐시 조회 실패:', error.message);
    return midMap;
  }

  for (const row of data || []) {
    const linkUrl = (row as any).link_url;
    const mid = typeof (row as any).mid === 'string' ? (row as any).mid.trim() : '';
    if (linkUrl && mid) {
      midMap.set(linkUrl, mid);
    }
  }

  console.log(`📦 캐시된 MID: ${midMap.size}개 / ${urls.length}개`);
  return midMap;
}

// 작업 할당 (last_check_date 기준)
async function claimKeywords(claimLimit: number): Promise<any[]> {
  // 아직 체크하지 않은 것 (last_check_date가 created_at과 같거나 오래된 것)
  // 또는 24시간 이상 지난 것
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('keywords_navershopping-test')
    .select('*')
    .or(`last_check_date.is.null,last_check_date.lt.${twentyFourHoursAgo}`)
    .order('last_check_date', { ascending: true, nullsFirst: true })
    .limit(claimLimit);

  if (error) {
    console.error('❌ 작업 조회 실패:', error.message);
    return [];
  }

  console.log(`   📋 처리 대상: ${data?.length || 0}개`);
  return data || [];
}

// 단일 결과 처리
async function processResult(
  result: ParallelRankResult,
  keywordRecord: KeywordRecord
): Promise<void> {
  console.log(`\n📝 저장: ${keywordRecord.keyword}`);
  const now = new Date().toISOString();

  // MID 추출 실패
  if (result.midSource === 'failed' || result.error === 'MID 추출 실패') {
    console.log(`   ❌ MID 추출 실패`);
    failedCount++;

    // last_check_date 업데이트 (다음에 다시 시도)
    await supabase.from('keywords_navershopping-test').update({
      last_check_date: now,
    }).eq('id', keywordRecord.id);

    return;
  }

  // 차단 감지
  if (result.blocked) {
    blockedCount++;
    consecutiveBlocked++;
    console.log(`   🛑 차단 감지 (연속 ${consecutiveBlocked}개)`);

    if (consecutiveBlocked >= BLOCK_THRESHOLD) {
      console.log(`\n🔄 IP 로테이션 실행...`);
      const rotationResult = await rotateIP();
      if (rotationResult.success) {
        console.log(`✅ IP 변경: ${rotationResult.oldIP} → ${rotationResult.newIP}`);
      }
      consecutiveBlocked = 0;
      await new Promise((r) => setTimeout(r, IP_ROTATION_COOLDOWN_MS));
    }

    // 차단은 last_check_date 업데이트 안 함 (바로 재시도 가능)
    return;
  }

  consecutiveBlocked = 0;

  // 순위 결과 처리
  if (result.rank && result.rank.totalRank > 0) {
    console.log(`   ✅ 순위: ${result.rank.totalRank}위 (${result.rank.isAd ? '광고' : '오가닉'}) | MID: ${result.mid || 'NULL'}${result.midSource ? ` (${result.midSource})` : ''}`);
    successCount++;

    // slot_navertest에 저장
    const saveResult = await saveRankToSlotNaverTest(supabase, keywordRecord, result.rank);
    if (!saveResult.success) {
      console.log(`   ⚠️ 저장 실패: ${saveResult.error}`);
      failedCount++;
      return;
    }

    // keywords_navershopping-test 업데이트
    await supabase.from('keywords_navershopping-test').update({
      current_rank: result.rank.totalRank,
      last_check_date: now,
    }).eq('id', keywordRecord.id);

    console.log(`   💾 순위 업데이트 완료`);
  } else {
    // 순위 미발견
    console.log(`   ❌ 600위 내 미발견`);
    notFoundCount++;

    await saveRankToSlotNaverTest(supabase, keywordRecord, null);

    // keywords_navershopping-test 업데이트 (current_rank = -1)
    await supabase.from('keywords_navershopping-test').update({
      current_rank: -1,
      last_check_date: now,
    }).eq('id', keywordRecord.id);

    console.log(`   📝 미발견 기록됨`);
  }
}

async function main() {
  const { workers, limit } = parseArgs();
  const CPU_CORES = os.cpus().length;
  const TOTAL_RAM_GB = Math.round(os.totalmem() / (1024 ** 3));

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 [TEST] 워커 풀 방식 순위 체크');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🖥️  PC: ${os.hostname()}`);
  console.log(`💻 CPU: ${CPU_CORES}코어 | RAM: ${TOTAL_RAM_GB}GB`);
  console.log(`👷 워커: ${workers}개`);
  console.log(`🔧 Worker ID: ${WORKER_ID}`);
  console.log(`📁 테이블: keywords_navershopping-test, slot_navertest`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 작업 할당
  console.log('1️⃣ 작업 조회 중...\n');
  const claimLimit = limit || 1000;
  const keywords = await claimKeywords(claimLimit);

  if (keywords.length === 0) {
    console.log('⚠️ 처리할 키워드가 없습니다.');
    return;
  }

  console.log(`✅ ${keywords.length}개 키워드 조회 완료\n`);

  // MID 캐시 조회
  const urls = keywords.map((k: any) => k.link_url);
  const cachedMidMap = await getCachedMids(urls);

  // 요청 배열 생성
  const requests = keywords.map((k: any) => ({
    url: k.link_url,
    keyword: k.keyword,
    maxPages: MAX_PAGES,
    cachedMid: cachedMidMap.get(k.link_url),
  }));

  const startTime = Date.now();

  // 워커 풀 실행
  console.log('2️⃣ 워커 풀 순위 체크 시작...\n');

  const checker = new ParallelRankChecker();
  const results = await checker.checkUrlsWithWorkerPool(
    requests,
    workers,
    async (result, index) => {
      const keywordRecord: KeywordRecord = keywords[index];
      await processResult(result, keywordRecord);
    }
  );

  const totalDuration = Date.now() - startTime;

  // 최종 결과
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 [TEST] 최종 결과');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`총 처리: ${keywords.length}개`);
  console.log(`✅ 순위 발견: ${successCount}개`);
  console.log(`❌ 미발견: ${notFoundCount}개`);
  console.log(`🛑 차단: ${blockedCount}개`);
  console.log(`🚨 실패: ${failedCount}개`);
  console.log(`\n⏱️ 총 소요: ${Math.round(totalDuration / 1000)}초 (${Math.round(totalDuration / 60000)}분)`);
  if (keywords.length > 0 && totalDuration > 0) {
    console.log(`⚡ 처리 속도: ${Math.round((keywords.length / totalDuration) * 60000)}개/분\n`);
  }

  // JSON 저장
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const filename = `test-worker-pool-results-${timestamp}.json`;

  fs.writeFileSync(filename, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: { workers, maxPages: MAX_PAGES },
    summary: {
      total: keywords.length,
      success: successCount,
      notFound: notFoundCount,
      blocked: blockedCount,
      failed: failedCount,
      duration: totalDuration,
    },
  }, null, 2), 'utf-8');

  console.log(`💾 결과 저장: ${filename}\n`);
}

main().catch((error) => {
  console.error('\n🚨 치명적 에러:', error.message);
  console.error(error.stack);
  process.exit(1);
});
