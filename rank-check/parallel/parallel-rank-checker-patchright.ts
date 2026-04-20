/**
 * 병렬 순위 체크 시스템 (Patchright 버전)
 *
 * Patchright (패치된 Playwright)를 사용하여 봇 탐지를 우회합니다.
 * puppeteer-real-browser 대비 더 가볍고 빠릅니다.
 */

import { chromium, type BrowserContext } from 'patchright';
import { findAccurateRank, type RankResult } from '../accurate-rank-checker';
import { urlToMid, type MidExtractionResult } from '../utils/url-to-mid-converter';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// 워커별 프로필 경로 (쿠키/세션 유지)
function getWorkerProfilePath(workerId: number): string {
  const profilePath = path.join(os.tmpdir(), `patchright-rank-worker-${workerId}`);
  if (!fs.existsSync(profilePath)) {
    fs.mkdirSync(profilePath, { recursive: true });
  }
  return profilePath;
}

export interface ParallelRankRequest {
  url: string;
  keyword: string;
  productName?: string;
  maxPages?: number;
  cachedMid?: string;  // 이미 저장된 MID (있으면 URL 방문 skip)
}

export interface ParallelRankResult {
  url: string;
  keyword: string;
  productName?: string;
  mid: string | null;
  midSource: 'direct' | 'catalog' | 'cached' | 'failed' | 'captcha_failed';
  rank: RankResult | null;
  duration: number;
  error?: string;
  blocked?: boolean;  // 차단 감지 여부
}

export class ParallelRankCheckerPatchright {
  /**
   * 단일 URL의 순위를 체크합니다
   */
  private async checkSingleUrl(
    request: ParallelRankRequest,
    index: number
  ): Promise<ParallelRankResult> {
    const startTime = Date.now();

    console.log(
      `[${index + 1}] 🌐 브라우저 시작: ${request.url.substring(0, 60)}...`
    );

    let context: BrowserContext | null = null;

    try {
      // Patchright: launchPersistentContext 사용
      const userDataDir = getWorkerProfilePath(index);
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        channel: 'chrome',
        args: [
          '--window-size=1200,900',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
        ],
        viewport: { width: 1180, height: 800 },
        locale: 'ko-KR',
      });

      const page = context.pages()[0] || await context.newPage();

      // cachedMid가 있으면 URL 방문 skip
      let mid: string;
      let midSource: 'direct' | 'catalog' | 'cached' | 'failed' | 'captcha_failed';

      if (request.cachedMid) {
        mid = request.cachedMid;
        midSource = 'cached';
        console.log(`[${index + 1}] ⚡ 캐시된 MID 사용: ${mid}`);
      } else {
        // URL → MID 변환 (스마트스토어 방문)
        const midResult: MidExtractionResult = await urlToMid(request.url, page);

        if (!midResult.mid) {
          await context.close();
          // 캡챠 실패 시 별도 처리
          const isCaptchaFailed = midResult.source === 'captcha_failed';
          return {
            url: request.url,
            keyword: request.keyword,
            productName: request.productName,
            mid: null,
            midSource: isCaptchaFailed ? 'captcha_failed' : 'failed',
            rank: null,
            duration: Date.now() - startTime,
            error: isCaptchaFailed ? '캡챠 실패 - 재시도 필요' : 'MID 추출 실패',
          };
        }

        mid = midResult.mid;
        midSource = midResult.source;
        console.log(`[${index + 1}] ✅ MID 추출: ${mid} (${midSource})`);
      }

      // 순위 체크
      const maxPages = request.maxPages ?? 15;
      const rankResult = await findAccurateRank(
        page,
        request.keyword,
        mid,
        maxPages
      );

      // 브라우저 종료
      await context.close();

      const duration = Date.now() - startTime;

      // 차단 감지 여부 확인
      const isBlocked = rankResult?.blocked === true;
      if (isBlocked) {
        console.log(`[${index + 1}] 🛑 차단 감지됨`);
      } else {
        console.log(`[${index + 1}] ⏱️  완료: ${Math.round(duration / 1000)}초`);
      }

      return {
        url: request.url,
        keyword: request.keyword,
        productName: request.productName,
        mid: mid,
        midSource: midSource,
        rank: rankResult,
        duration,
        blocked: isBlocked,
      };
    } catch (error: any) {
      console.log(`[${index + 1}] ❌ 에러: ${error.message}`);

      // 브라우저 강제 종료
      if (context) {
        await context.close().catch(() => {});
      }

      return {
        url: request.url,
        keyword: request.keyword,
        productName: request.productName,
        mid: null,
        midSource: 'failed',
        rank: null,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * 여러 URL을 병렬로 순위 체크합니다
   */
  async checkUrls(
    requests: ParallelRankRequest[]
  ): Promise<ParallelRankResult[]> {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔄 병렬 순위 체크 시작 (Patchright): ${requests.length}개 URL`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const startTime = Date.now();

    // 브라우저 시작 시차 적용 (랜덤 딜레이 0~1초)
    const promises = requests.map((request, index) => {
      const randomDelayMs = Math.random() * 1000;

      return new Promise<ParallelRankResult>((resolve) => {
        setTimeout(async () => {
          const result = await this.checkSingleUrl(request, index);
          resolve(result);
        }, randomDelayMs);
      });
    });

    const results = await Promise.all(promises);

    const totalDuration = Date.now() - startTime;
    console.log(
      `\n✅ 모든 체크 완료: ${Math.round(totalDuration / 1000)}초`
    );

    return results;
  }

  /**
   * 워커 풀 방식으로 순위 체크 (각 워커 독립적 생명주기)
   */
  async checkUrlsWithWorkerPool(
    requests: ParallelRankRequest[],
    numWorkers: number = 4,
    onResult?: (result: ParallelRankResult, index: number) => Promise<void>
  ): Promise<ParallelRankResult[]> {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔄 워커 풀 순위 체크 시작 (Patchright)`);
    console.log(`   📋 총 ${requests.length}개 | 👷 워커 ${numWorkers}개`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const startTime = Date.now();
    const results: ParallelRankResult[] = new Array(requests.length);
    let nextIndex = 0;
    let completedCount = 0;

    // 워커 함수: 큐에서 작업을 가져와 처리
    const worker = async (workerId: number): Promise<void> => {
      while (true) {
        // 다음 작업 가져오기 (atomic)
        const currentIndex = nextIndex++;
        if (currentIndex >= requests.length) {
          break; // 더 이상 작업 없음
        }

        const request = requests[currentIndex];
        console.log(`[W${workerId}] 🔍 #${currentIndex + 1}/${requests.length}: ${request.keyword}`);

        // 순위 체크 실행
        const result = await this.checkSingleUrl(request, workerId);
        results[currentIndex] = result;
        completedCount++;

        // 진행률 표시
        const progress = Math.round((completedCount / requests.length) * 100);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`[W${workerId}] ✅ 완료 (${completedCount}/${requests.length}, ${progress}%, ${elapsed}초)`);

        // 콜백 호출 (실시간 저장)
        if (onResult) {
          try {
            await onResult(result, currentIndex);
          } catch (err: any) {
            console.error(`[W${workerId}] ⚠️ 콜백 에러: ${err.message}`);
          }
        }

        // 짧은 랜덤 딜레이 (봇 감지 회피)
        const delay = 500 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      }
    };

    // N개 워커 동시 시작
    const workerPromises = Array.from({ length: numWorkers }, (_, i) => worker(i));
    await Promise.all(workerPromises);

    const totalDuration = Date.now() - startTime;
    const avgPerItem = Math.round(totalDuration / requests.length / 1000);

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ 워커 풀 완료 (Patchright)`);
    console.log(`   ⏱️  총 ${Math.round(totalDuration / 1000)}초 (평균 ${avgPerItem}초/건)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    return results;
  }
}
