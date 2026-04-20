#!/usr/bin/env npx tsx
/**
 * 2개 URL 병렬 순위 체크 CLI
 *
 * 사용법:
 *   npx tsx rank-check/parallel/check-2-urls.ts <URL1> <URL2> --keyword="키워드"
 *
 * 예시:
 *   npx tsx rank-check/parallel/check-2-urls.ts \
 *     "https://smartstore.naver.com/sgata/products/5671646899" \
 *     "https://smartstore.naver.com/dreamfactory/products/10823172837" \
 *     --keyword="장난감"
 */

import 'dotenv/config';
import { ParallelRankChecker } from './parallel-rank-checker';

async function main() {
  const args = process.argv.slice(2);

  // 인자 검증
  if (args.length < 2) {
    console.error('❌ 사용법: check-2-urls.ts <URL1> <URL2> --keyword="키워드"');
    console.error('\n예시:');
    console.error('  npx tsx rank-check/parallel/check-2-urls.ts \\');
    console.error('    "https://smartstore.naver.com/.../products/123" \\');
    console.error('    "https://smartstore.naver.com/.../products/456" \\');
    console.error('    --keyword="장난감"');
    process.exit(1);
  }

  const url1 = args[0];
  const url2 = args[1];

  // 키워드 추출
  const keywordArg = args.find((arg) => arg.startsWith('--keyword='));
  const keyword =
    keywordArg?.split('=')[1]?.replace(/['"]/g, '') || '장난감';

  // 헤더 출력
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 병렬 순위 체크 (2개 URL)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`📌 키워드: "${keyword}"\n`);
  console.log(`[1] ${url1}`);
  console.log(`[2] ${url2}`);
  console.log('');

  // 병렬 체크 실행
  const startTime = Date.now();
  const checker = new ParallelRankChecker();

  const results = await checker.checkUrls([
    { url: url1, keyword },
    { url: url2, keyword },
  ]);

  const totalDuration = Date.now() - startTime;

  // 결과 출력
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 최종 결과');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  results.forEach((result, index) => {
    const urlShort = result.url.length > 70
      ? result.url.substring(0, 70) + '...'
      : result.url;

    console.log(`[${index + 1}] ${urlShort}`);
    console.log(
      `    MID: ${result.mid || 'EXTRACTION_FAILED'} (출처: ${result.midSource})`
    );

    if (result.rank) {
      console.log(`    📦 상품명: ${result.rank.productName}`);
      console.log(`    ✅ 순위 발견: ${result.rank.totalRank}위`);
      console.log(`       • 페이지: ${result.rank.page}페이지`);
      console.log(`       • 페이지 내 위치: ${result.rank.pagePosition}번째`);
      console.log(
        `       • 오가닉 순위: ${
          result.rank.organicRank > 0 ? result.rank.organicRank + '위' : 'N/A'
        }`
      );
      console.log(`       • 광고: ${result.rank.isAd ? 'YES' : 'NO'}`);
    } else {
      console.log(`    ❌ 600위 내 순위 없음 (15페이지)`);
    }

    console.log(
      `    ⏱️  소요 시간: ${Math.round(result.duration / 1000)}초`
    );

    if (result.error) {
      console.log(`    ⚠️  에러: ${result.error}`);
    }

    console.log('');
  });

  // 성능 요약
  const sequentialTime = results.length * 28; // 예상 순차 시간
  const actualTime = Math.round(totalDuration / 1000);
  const speedup = (sequentialTime / actualTime).toFixed(1);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`⏱️  총 소요 시간: ${actualTime}초`);
  console.log(
    `📈 순차 실행 대비: ${sequentialTime}초 → ${actualTime}초 (${speedup}x 빠름)`
  );
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch((error) => {
  console.error('\n🚨 치명적 에러:', error.message);
  process.exit(1);
});
