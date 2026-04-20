#!/usr/bin/env npx tsx
/**
 * 워커 풀 방식 배치 순위 체크
 *
 * 특징:
 * - 4개 브라우저가 독립적 생명주기로 동작
 * - 하나 끝나면 바로 다음 키워드 처리 (대기 없음)
 * - 실시간 저장 및 모니터링
 * - 4분할 화면 배치로 실시간 확인 가능
 *
 * 사용법:
 *   npx tsx rank-check/batch/check-batch-worker-pool.ts [--workers=N] [--limit=N]
 *
 * 예시:
 *   npx tsx rank-check/batch/check-batch-worker-pool.ts              # 4워커로 전체 처리
 *   npx tsx rank-check/batch/check-batch-worker-pool.ts --workers=2  # 2워커로 처리
 *   npx tsx rank-check/batch/check-batch-worker-pool.ts --limit=20   # 20개만 처리
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { ParallelRankChecker, type ParallelRankResult } from '../parallel/parallel-rank-checker';
import { saveRankToSlotNaver, type KeywordRecord } from '../utils/save-rank-to-slot-naver';
import { TABLE_KEYWORDS } from '../config/supabase-tables';
import { rotateIP } from '../utils/ipRotation';
import * as fs from 'fs';
import * as os from 'os';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 설정
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const DEFAULT_WORKERS = 1;
const MAX_PAGES = parseInt(process.env.MAX_PAGES || '15', 10);
const STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30분 (타임아웃 복구)
const STALE_CHECK_INTERVAL_MS = 60 * 1000; // 1분마다 stale 체크

// 차단 감지 설정
const BLOCK_THRESHOLD = 5;  // 연속 N개 차단 시 IP 로테이션
const IP_ROTATION_COOLDOWN_MS = 15000;

// PC 식별자 (다중 PC 실행 시 assigned_to 락용)
const PC_ID = process.env.PC_ID || process.env.COMPUTERNAME || process.env.HOSTNAME || os.hostname() || `PC-${Date.now()}`;

// 워커 ID 생성
const WORKER_ID = `${os.hostname()}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;

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

// 셀러메이트 키워드 테이블에는 status 없음 → 타임아웃 복구 불필요
async function recoverStaleKeywords(): Promise<number> {
  return 0;
}

// 작업 할당 (assigned_to null만 조회 후 원자적 락)
async function claimKeywords(claimLimit: number): Promise<any[]> {
  const { data: available, error: selectError } = await supabase
    .from(TABLE_KEYWORDS)
    .select('id, slot_id, keyword, link_url, slot_sequence, slot_type, customer_id')
    .not('slot_id', 'is', null)
    .not('keyword', 'is', null)
    .not('link_url', 'is', null)
    .is('assigned_to', null)
    .order('last_check_date', { ascending: true, nullsFirst: true })
    .order('id', { ascending: false })
    .limit(claimLimit);

  if (selectError || !available || available.length === 0) {
    if (selectError) console.error('   ❌ 데이터 조회 실패:', selectError.message);
    return [];
  }

  const claimed: any[] = [];
  for (const row of available) {
    const { data: updated, error: updateError } = await supabase
      .from(TABLE_KEYWORDS)
      .update({ assigned_to: PC_ID })
      .eq('id', row.id)
      .is('assigned_to', null)
      .select('id, slot_id, keyword, link_url, slot_sequence, slot_type, customer_id')
      .single();
    if (!updateError && updated) claimed.push(updated);
  }
  if (claimed.length > 0) console.log(`   📋 ${claimed.length}개 할당 완료 (${TABLE_KEYWORDS}, PC: ${PC_ID})`);
  return claimed;
}

// 단일 결과 처리 (순위 발견 시 저장, 결과와 상관없이 삭제)
async function processResult(
  result: ParallelRankResult,
  keywordRecord: KeywordRecord
): Promise<void> {
  const slotInfo = keywordRecord.slot_id 
    ? `[slot_id: ${keywordRecord.slot_id}]` 
    : '';
  console.log(`\n📝 처리: ${keywordRecord.keyword} ${slotInfo}`);

  // 차단 감지 (IP 로테이션만 처리)
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
  } else {
    consecutiveBlocked = 0;
  }

  // 순위 발견 → 저장
  if (result.rank && result.rank.totalRank > 0) {
    console.log(`   ✅ 순위: ${result.rank.totalRank}위`);
    successCount++;

    const saveResult = await saveRankToSlotNaver(supabase, keywordRecord, result.rank);
    if (!saveResult.success) {
      console.log(`   ⚠️ 저장 실패: ${saveResult.error}`);
      failedCount++;
    }
  } else {
    // 순위 미발견 (차단, MID 실패, 600위 밖 등)
    console.log(`   ❌ 순위 미발견`);
    notFoundCount++;
  }

  // 작업 완료 후 삭제 (본인 할당분만 삭제)
  const { error: deleteError } = await supabase
    .from(TABLE_KEYWORDS)
    .delete()
    .eq('id', keywordRecord.id)
    .eq('assigned_to', PC_ID);
  if (deleteError) {
    console.log(`   ⚠️ 삭제 실패: ${deleteError.message}`);
  } else {
    console.log(`   🗑️ 삭제 완료 (id: ${keywordRecord.id})`);
  }
}

const BATCH_COOLDOWN_MS = 5000; // 한 번치 처리 후 다음 키워드 조회 전 대기 (5초)

async function main() {
  const { workers, limit } = parseArgs();
  const CPU_CORES = os.cpus().length;
  const TOTAL_RAM_GB = Math.round(os.totalmem() / (1024 ** 3));
  const claimLimit = limit || 1000;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 워커 풀 방식 순위 체크 (24시간 풀가동)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🖥️  PC: ${os.hostname()}`);
  console.log(`💻 CPU: ${CPU_CORES}코어 | RAM: ${TOTAL_RAM_GB}GB`);
  console.log(`👷 워커: ${workers}개`);
  console.log(`🔧 Worker ID: ${WORKER_ID}`);
  console.log('   키워드 처리 완료 시 자동으로 다음 목록 조회 후 계속 실행 (Ctrl+C 종료)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 24시간 풀가동: 키워드 처리 → 완료 후 다시 조회 → 반복
  while (true) {
    // 배치별 카운터 초기화
    successCount = 0;
    failedCount = 0;
    notFoundCount = 0;
    blockedCount = 0;
    consecutiveBlocked = 0;

    const recoveredCount = await recoverStaleKeywords();
    if (recoveredCount > 0) {
      console.log(`   🔄 타임아웃 작업 복구: ${recoveredCount}개\n`);
    }

    // 작업 할당 (키워드 없으면 5초 후 재시도)
    console.log('1️⃣ 작업 할당 중...\n');
    let keywords = await claimKeywords(claimLimit);
    while (keywords.length === 0) {
      console.log('⚠️ 키워드 없음. 5초 후 재시도...');
      await new Promise((r) => setTimeout(r, 5000));
      keywords = await claimKeywords(claimLimit);
    }

    console.log(`✅ ${keywords.length}개 키워드 할당 완료\n`);

    const requests = keywords.map((k) => ({
      url: k.link_url,
      keyword: k.keyword,
      maxPages: MAX_PAGES,
    }));

    const startTime = Date.now();

    console.log('2️⃣ 워커 풀 순위 체크 시작...\n');

    const checker = new ParallelRankChecker();
    await checker.checkUrlsWithWorkerPool(
      requests,
      workers,
      async (result, index) => {
        const keywordRecord: KeywordRecord = keywords[index];
        await processResult(result, keywordRecord);
      }
    );

    const totalDuration = Date.now() - startTime;

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 이번 배치 결과');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`총 처리: ${keywords.length}개`);
    console.log(`✅ 순위 발견: ${successCount}개`);
    console.log(`❌ 미발견: ${notFoundCount}개`);
    console.log(`🛑 차단: ${blockedCount}개`);
    console.log(`🚨 실패: ${failedCount}개`);
    console.log(`⏱️ 소요: ${Math.round(totalDuration / 1000)}초 | ⚡ ${Math.round((keywords.length / totalDuration) * 60000)}개/분\n`);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `worker-pool-results-${timestamp}.json`;
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

    const endTimeStr = new Date().toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    console.log(`✅ 배치 완료: ${endTimeStr}`);
    console.log(`🔄 ${BATCH_COOLDOWN_MS / 1000}초 후 다음 키워드 목록 조회...\n`);
    await new Promise((r) => setTimeout(r, BATCH_COOLDOWN_MS));
  }
}

main().catch((error) => {
  console.error('\n🚨 치명적 에러:', error.message);
  console.error(error.stack);
  process.exit(1);
});
