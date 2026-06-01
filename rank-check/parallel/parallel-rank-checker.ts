/**
 * 병렬 순위 체크 시스템 (ProductId 방식 전용)
 *
 * 여러 URL의 순위를 동시에 체크하여 전체 실행 시간을 단축합니다.
 * 각 URL마다 독립적인 브라우저 인스턴스를 사용하여 에러를 격리합니다.
 *
 * ✅ ProductId 방식만 사용 (URL 직접 방문 제거):
 * - URL에서 productId 추출 (/products/숫자)
 * - 네이버 검색 → 쇼핑탭 → DOM에서 chnl_prod_no 매칭
 * - 캡챠 없음, 빠름
 */

import { connect } from 'puppeteer-real-browser';
import { type RankResult } from '../utils/save-rank-to-slot-naver';
import { extractNvMidFromUrl } from '../utils/extractMidFromUrl';
import { midSourceLabel, resolveStoredMid } from '../utils/resolve-shopping-mid';
import { humanScroll, humanType, injectEvaluatePolyfill } from '../utils/humanBehavior';
import { evaluateString, runFindRankByProductIdOnPage } from './browser-eval';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// ProductId 방식 상수
const SAFE_DELAY_MS = 1500; // 2500 → 1500 (40% 추가 감소, 총 70% 감소)
const SCROLL_STEPS = 18; // 원래 값으로 복원
const MAX_PAGES_PRODUCTID = 15;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ProductId 방식 헬퍼 함수들
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * URL에서 productId 추출 (모든 네이버 URL)
 * - smartstore.naver.com/xxx/products/12345
 * - brand.naver.com/xxx/products/12345
 * - shopping.naver.com/xxx/products/12345
 */
function extractProductIdFromUrl(url: string): string | null {
  const match = url.match(/\/products\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * ProductId 추출 가능한 URL인지 확인
 */
function hasProductId(url: string): boolean {
  return extractProductIdFromUrl(url) !== null;
}

/**
 * 차단 여부 확인
 */
async function isBlocked(page: any): Promise<boolean> {
  return evaluateString<boolean>(
    page,
    `(() => {
      const bodyText = document.body && document.body.innerText ? document.body.innerText : '';
      return bodyText.includes('보안 확인')
        || bodyText.includes('자동 입력 방지')
        || bodyText.includes('일시적으로 제한');
    })()`
  );
}

/**
 * 쇼핑탭 진입 (productId 방식용)
 */
async function enterShoppingTabForProductId(page: any, keyword: string, logPrefix: string): Promise<boolean> {
  console.log(`${logPrefix} 🧭 네이버 메인 진입`);
  try {
    await page.goto('https://www.naver.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
  } catch (error) {
    console.log(`${logPrefix} ⚠️ 네이버 진입 실패`);
    return false;
  }

  await injectEvaluatePolyfill(page).catch(() => {});
  await delay(SAFE_DELAY_MS);

  const searchInput = await page.waitForSelector('input[name="query"]', { timeout: 15000 }).catch(() => null);
  if (!searchInput) {
    console.log(`${logPrefix} ❌ 검색 입력창 없음`);
    return false;
  }

  await searchInput.click({ clickCount: 3 });
  await humanType(page, keyword);
  await page.keyboard.press('Enter');

  console.log(`${logPrefix} ⏳ 검색 결과 대기...`);
  try {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch {}
  await delay(1000); // 2000 → 1000 (50% 추가 감소, 총 67% 감소)

  console.log(`${logPrefix} 🛒 쇼핑탭 이동`);
  let clicked = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    clicked = await evaluateString<boolean>(
      page,
      `(() => {
        const link = document.querySelector('a[href*="search.shopping.naver.com"]');
        if (!link) return false;
        link.removeAttribute('target');
        link.click();
        return true;
      })()`
    );
    if (clicked) break;
    await delay(2000);
  }

  if (!clicked) {
    console.log(`${logPrefix} ❌ 쇼핑탭 링크 없음`);
    return false;
  }

  await delay(SAFE_DELAY_MS + 800);

  if (!page.url().includes('search.shopping.naver.com')) {
    console.log(`${logPrefix} ⚠️ 쇼핑탭 URL 미확인`);
    return false;
  }

  if (await isBlocked(page)) {
    console.log(`${logPrefix} 🛑 보안 페이지 감지`);
    return false;
  }

  return true;
}

/**
 * 스크롤로 lazy loading 트리거
 */
async function hydrateCurrentPage(page: any): Promise<void> {
  await evaluateString(page, 'window.scrollTo(0, 0)');
  await humanScroll(page, SCROLL_STEPS * 550);
  await delay(150); // 300 → 150 (50% 추가 감소, 총 75% 감소)
}

/**
 * 현재 페이지에서 productId로 순위 찾기
 */
async function findRankByProductIdOnPage(
  page: any,
  targetProductId: string | null
): Promise<{
  found: boolean;
  pageRank: number | null;
  nvMid: string | null;
  contentsId: string | null;
  catalogNvMid: string | null;
  chnlProdNo: string | null;
  productName: string | null;
  isAd: boolean;
  productIndex: number | null;
  wishCount: number | null;
  reviewCount: number | null;
  starCount: number | null;
  monthCount: number | null;
  productImageUrl: string | null;
  price: number | null;
  shippingFee: number | null;
  keywordName: string | null;
  tradeName: string | null;
}> {
  return runFindRankByProductIdOnPage(page, targetProductId);
}

/**
 * 상품 상세페이지 클릭 및 체류
 */
async function clickProductAndStay(page: any, productIndex: number, logPrefix: string): Promise<boolean> {
  try {
    console.log(`${logPrefix} 🖱️ 상품 상세페이지 클릭 중...`);
    
    // 해당 인덱스의 상품 앵커 찾기 및 클릭
    const clicked = await evaluateString<boolean>(
      page,
      `(() => {
        const index = ${productIndex};
        const anchors = document.querySelectorAll('a[data-shp-contents-id][data-shp-contents-rank][data-shp-contents-dtl]');
        if (index >= anchors.length) return false;
        const anchor = anchors[index];
        if (!anchor) return false;
        anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        anchor.click();
        return true;
      })()`
    );
    
    if (!clicked) {
      console.log(`${logPrefix} ⚠️ 상품 앵커를 찾을 수 없습니다.`);
      return false;
    }
    
    await delay(500);
    
    // 상세페이지 로드 대기
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await delay(2000);
    
    // 상세페이지 URL 확인
    const currentUrl = page.url();
    if (currentUrl.includes('smartstore.naver.com') || currentUrl.includes('shopping.naver.com')) {
      console.log(`${logPrefix} ✅ 상세페이지 진입: ${currentUrl.substring(0, 80)}...`);
      
      // 상세페이지 뷰포트 크기 조정
      await page.setViewport({ width: 1920, height: 1080 });
      await delay(500);
      
      // 상세페이지에서 일정 시간 체류 (3~5초)
      const stayTime = 3000 + Math.random() * 2000;
      console.log(`${logPrefix} ⏳ 상세페이지 체류 중... (${Math.round(stayTime / 1000)}초)`);
      await delay(stayTime);
      
      // 약간의 스크롤 (자연스러운 행동)
      await evaluateString(
        page,
        `window.scrollBy(0, ${300 + Math.random() * 200})`
      );
      await delay(1000);
      
      return true;
    } else {
      console.log(`${logPrefix} ⚠️ 상세페이지 진입 실패: ${currentUrl}`);
      return false;
    }
  } catch (error: any) {
    console.log(`${logPrefix} ⚠️ 상품 클릭 실패: ${error.message}`);
    return false;
  }
}

/**
 * 다음 페이지 이동
 */
async function goToNextPageForProductId(page: any, targetPage: number): Promise<boolean> {
  const paginationSelector = 'a.pagination_btn_page__utqBz, a[class*="pagination_btn"]';

  try {
    await page.waitForSelector(paginationSelector, { timeout: 10000, visible: true });
  } catch {
    return false;
  }

  const buttonExists = await evaluateString<boolean>(
    page,
    `(() => {
      const nextPage = ${targetPage};
      const buttons = document.querySelectorAll('a.pagination_btn_page__utqBz, a[class*="pagination_btn"]');
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        const text = btn.textContent ? btn.textContent.trim() : '';
        if (text === String(nextPage)) return true;
      }
      return false;
    })()`
  );

  if (!buttonExists) return false;

  const apiResponsePromise = page.waitForResponse(
    (response: any) => {
      const url = response.url();
      return url.includes('/api/search/all') && url.includes(`pagingIndex=${targetPage}`);
    },
    { timeout: 30000 }
  );

  try {
    const clicked = await evaluateString<boolean>(
      page,
      `(() => {
        const nextPage = ${targetPage};
        const buttons = document.querySelectorAll('a.pagination_btn_page__utqBz, a[class*="pagination_btn"]');
        for (let i = 0; i < buttons.length; i++) {
          const btn = buttons[i];
          const text = btn.textContent ? btn.textContent.trim() : '';
          if (text === String(nextPage)) {
            btn.click();
            return true;
          }
        }
        return false;
      })()`
    );
    if (!clicked) return false;
  } catch {
    return false;
  }

  try {
    await apiResponsePromise;
  } catch {}

  await delay(1500);
  return true;
}

/**
 * ProductId 기반 순위 체크 (스마트스토어 URL용)
 */
async function checkRankByProductId(
  page: any,
  keyword: string,
  productId: string | null,
  logPrefix: string
): Promise<{
  rank: number | null;
  nvMid: string | null;
  contentsId: string | null;
  catalogNvMid: string | null;
  chnlProdNo: string | null;
  productName: string | null;
  page: number | null;
  isAd: boolean;
  blocked: boolean;
  error?: string;
  wishCount: number | null;
  reviewCount: number | null;
  starCount: number | null;
  monthCount: number | null;
  productImageUrl: string | null;
  price: number | null;
  shippingFee: number | null;
  keywordName: string | null;
  tradeName: string | null;
}> {
  // 쇼핑탭 진입
  const shoppingReady = await enterShoppingTabForProductId(page, keyword, logPrefix);
  if (!shoppingReady) {
    const blocked = await isBlocked(page);
    return {
      rank: null,
      nvMid: null,
      contentsId: null,
      catalogNvMid: null,
      chnlProdNo: null,
      productName: null,
      page: null,
      isAd: false,
      blocked,
      error: blocked ? '보안 페이지' : '쇼핑탭 진입 실패',
      wishCount: null,
      reviewCount: null,
      starCount: null,
      monthCount: null,
      productImageUrl: null,
      price: null,
      shippingFee: null,
      keywordName: null,
      tradeName: null,
    };
  }

  // 페이지 순회
  for (let currentPage = 1; currentPage <= MAX_PAGES_PRODUCTID; currentPage++) {
    if (currentPage > 1) {
      const randomDelay = 1000 + Math.random() * 1000;
      await delay(randomDelay);

      const moved = await goToNextPageForProductId(page, currentPage);
      if (!moved) {
      return {
        rank: null,
        nvMid: null,
        contentsId: null,
        catalogNvMid: null,
        chnlProdNo: null,
        productName: null,
        page: null,
        isAd: false,
        blocked: false,
        error: `${currentPage - 1}페이지까지 검색`,
        wishCount: null,
        reviewCount: null,
        starCount: null,
        monthCount: null,
        productImageUrl: null,
        price: null,
        shippingFee: null,
        keywordName: null,
        tradeName: null,
      };
      }

      if (await isBlocked(page)) {
      return {
        rank: null,
        nvMid: null,
        contentsId: null,
        catalogNvMid: null,
        chnlProdNo: null,
        productName: null,
        page: currentPage,
        isAd: false,
        blocked: true,
        error: 'CAPTCHA',
        wishCount: null,
        reviewCount: null,
        starCount: null,
        monthCount: null,
        productImageUrl: null,
        price: null,
        shippingFee: null,
        keywordName: null,
        tradeName: null,
      };
      }
    }

    await hydrateCurrentPage(page);

    const result = await findRankByProductIdOnPage(page, productId);

    if (result.found && result.pageRank) {
      // 실제 순위 계산: (페이지 - 1) * 40 + 페이지 내 순위
      const actualRank = (currentPage - 1) * 40 + result.pageRank;

      // 상세페이지 진입 전 데이터 로그 출력
      console.log(`${logPrefix} 📊 상세페이지 진입 전 데이터 추출:`);
      if (result.wishCount !== null) console.log(`${logPrefix}   💝 찜개수: ${result.wishCount.toLocaleString()}개`);
      if (result.reviewCount !== null) console.log(`${logPrefix}   ⭐ 리뷰수: ${result.reviewCount.toLocaleString()}개`);
      if (result.starCount !== null) console.log(`${logPrefix}   🌟 별점: ${result.starCount}점`);
      if (result.monthCount !== null) console.log(`${logPrefix}   📦 6개월내구매수: ${result.monthCount.toLocaleString()}개`);
      if (result.productImageUrl) console.log(`${logPrefix}   🖼️ 썸네일: ${result.productImageUrl.substring(0, 80)}...`);
      if (result.price !== null) console.log(`${logPrefix}   💰 현재가: ${result.price.toLocaleString()}원`);
      if (result.shippingFee !== null) console.log(`${logPrefix}   🚚 배송비: ${result.shippingFee === 0 ? '무료' : result.shippingFee.toLocaleString() + '원'}`);
      if (result.keywordName) console.log(`${logPrefix}   📝 상품명: ${result.keywordName}`);
      if (result.tradeName) console.log(`${logPrefix}   🏪 상호명: ${result.tradeName}`);
      if (result.nvMid) console.log(`${logPrefix}   🆔 nv_mid(bridge): ${result.nvMid}`);
      if (result.contentsId)
        console.log(`${logPrefix}   🆔 contents-id: ${result.contentsId}`);
      if (result.catalogNvMid)
        console.log(`${logPrefix}   📎 catalog_nv_mid: ${result.catalogNvMid}`);
      if (result.chnlProdNo)
        console.log(`${logPrefix}   📎 chnl_prod_no: ${result.chnlProdNo}`);

      return {
        rank: actualRank,
        nvMid: result.nvMid,
        contentsId: result.contentsId,
        catalogNvMid: result.catalogNvMid,
        chnlProdNo: result.chnlProdNo,
        productName: result.productName,
        page: currentPage,
        isAd: result.isAd,
        blocked: false,
        wishCount: result.wishCount,
        reviewCount: result.reviewCount,
        starCount: result.starCount,
        monthCount: result.monthCount,
        productImageUrl: result.productImageUrl,
        price: result.price,
        shippingFee: result.shippingFee,
        keywordName: result.keywordName,
        tradeName: result.tradeName,
      };
    }

    if (currentPage < MAX_PAGES_PRODUCTID) {
      await delay(SAFE_DELAY_MS);
    }
  }

  return {
    rank: null,
    nvMid: null,
    contentsId: null,
    catalogNvMid: null,
    chnlProdNo: null,
    productName: null,
    page: null,
    isAd: false,
    blocked: false,
    error: `${MAX_PAGES_PRODUCTID}페이지까지 미발견`,
    wishCount: null,
    reviewCount: null,
    starCount: null,
    monthCount: null,
    productImageUrl: null,
    price: null,
    shippingFee: null,
    keywordName: null,
    tradeName: null,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 기존 코드
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 워커별 프로필 경로 (쿠키/세션 유지)
function getWorkerProfilePath(workerId: number): string {
  const profilePath = path.join(os.tmpdir(), `prb-rank-worker-${workerId}`);
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
}

export interface ParallelRankResult {
  url: string;
  keyword: string;
  productName?: string;
  mid: string | null;
  midSource: 'nv_mid' | 'contents_id' | 'catalog_nv_mid' | 'product_id' | 'failed';
  rank: RankResult | null;
  duration: number;
  error?: string;
  blocked?: boolean;
}

export class ParallelRankChecker {
  /**
   * 단일 URL의 순위를 체크합니다 (Promise.all 내부에서 실행됨)
   *
   * ✅ ProductId 방식만 사용:
   * - URL에서 productId 추출 → 네이버 검색 → DOM 매칭
   *
   * @param request - 순위 체크 요청
   * @param index - 요청 인덱스 (로그용)
   * @returns 순위 체크 결과
   */
  private async checkSingleUrl(
    request: ParallelRankRequest,
    index: number
  ): Promise<ParallelRankResult> {
    const startTime = Date.now();
    const logPrefix = `[${index + 1}]`;

    console.log(
      `${logPrefix} 🌐 브라우저 시작: ${request.url.substring(0, 60)}...`
    );

    let browser: any = null;
    let page: any = null;

    try {
      // 독립적인 브라우저 인스턴스 생성 (persistentContext)
      const userDataDir = getWorkerProfilePath(index);
      const connection = await connect({
        headless: false,  // Visible 모드 (창 보임)
        turnstile: true,
        fingerprint: true,
        customConfig: {
          userDataDir: userDataDir,
        },
      });

      browser = connection.browser;
      page = connection.page;

      await injectEvaluatePolyfill(page);

      // 뷰포트 크기 설정 (더 크게)
      await page.setViewport({ width: 1920, height: 1080 });

      // 페이지가 로드될 때까지 대기하여 하얀 화면 최소화
      await page.goto('about:blank', { waitUntil: 'domcontentloaded' }).catch(() => {});

      // ✅ about:blank 탭 정리 (무한 생성 버그 방지)
      try {
        const pages = await browser.pages();
        for (const p of pages) {
          if (p !== page && p.url() === 'about:blank') {
            await p.close().catch(() => {});
          }
        }
      } catch {}

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ✅ ProductId 방식만 사용 (URL 직접 방문 제거)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const nvMidFromUrl = extractNvMidFromUrl(request.url);
      const productId = extractProductIdFromUrl(request.url);

      if (!productId) {
        await browser.close();
        return {
          url: request.url,
          keyword: request.keyword,
          productName: request.productName,
          mid: null,
          midSource: 'failed',
          rank: null,
          duration: Date.now() - startTime,
          error: 'productId 추출 실패 (URL에 /products/숫자 없음)',
        };
      }

      console.log(
        `${logPrefix} 🚀 순위체크: productId=${productId ?? '-'} nv_mid=${nvMidFromUrl ?? '-'}`
      );

      const result = await checkRankByProductId(page, request.keyword, productId, logPrefix);

      await browser.close();

      const duration = Date.now() - startTime;

      if (result.blocked) {
        console.log(`${logPrefix} 🛑 차단 감지됨`);
      } else if (result.rank) {
        console.log(`${logPrefix} ✅ 순위 발견: ${result.rank}위 (${Math.round(duration / 1000)}초)`);
      } else {
        console.log(`${logPrefix} ❌ ${result.error || '미발견'} (${Math.round(duration / 1000)}초)`);
      }

      const effectiveNvMid = result.nvMid || nvMidFromUrl;
      const storedMid = resolveStoredMid(
        effectiveNvMid,
        result.contentsId,
        result.catalogNvMid,
        productId
      );
      const catalogMid = result.catalogNvMid;
      const channelProductNo = result.chnlProdNo || productId;

      if (result.rank) {
        console.log(
          `${logPrefix} 📦 저장 ID 후보: nv_mid=${effectiveNvMid ?? '-'} contentsId=${result.contentsId ?? '-'} catalog_mid=${catalogMid ?? '-'} channel_product_no=${channelProductNo ?? '-'} → mid=${storedMid ?? '-'}`
        );
      }

      // RankResult 형식으로 변환
      const rankResult: RankResult | null = result.rank ? {
        mid: storedMid || '',
        catalogMid,
        channelProductNo,
        contentsId: result.contentsId,
        nvMid: effectiveNvMid,
        productName: result.productName || request.productName || '',
        totalRank: result.rank,
        organicRank: result.isAd ? -1 : result.rank,
        isAd: result.isAd,
        page: result.page || 1,
        pagePosition: result.rank % 40 || 40,
        wishCount: result.wishCount,
        reviewCount: result.reviewCount,
        starCount: result.starCount,
        monthCount: result.monthCount,
        productImageUrl: result.productImageUrl,
        price: result.price,
        shippingFee: result.shippingFee,
        keywordName: result.keywordName,
        tradeName: result.tradeName,
      } : null;

      return {
        url: request.url,
        keyword: request.keyword,
        productName: result.productName || request.productName,
        mid: storedMid,
        midSource: midSourceLabel(
          storedMid,
          effectiveNvMid,
          result.contentsId,
          result.catalogNvMid,
          productId
        ),
        rank: rankResult,
        duration,
        blocked: result.blocked,
        error: result.error,
      };
    } catch (error: any) {
      console.log(`${logPrefix} ❌ 에러: ${error.message}`);

      // 브라우저 강제 종료
      if (browser) {
        await browser.close().catch(() => {});
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
   *
   * @param requests - 순위 체크 요청 배열
   * @returns 순위 체크 결과 배열
   *
   * @example
   * const checker = new ParallelRankChecker();
   * const results = await checker.checkUrls([
   *   { url: 'https://...', keyword: '장난감' },
   *   { url: 'https://...', keyword: '장난감' },
   * ]);
   */
  async checkUrls(
    requests: ParallelRankRequest[]
  ): Promise<ParallelRankResult[]> {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔄 순위 체크 시작: ${requests.length}개 URL`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const startTime = Date.now();
    const results: ParallelRankResult[] = [];

    // 1건일 때는 항상 순차 실행 (브라우저 1개만 사용)
    if (requests.length === 1) {
      const result = await this.checkSingleUrl(requests[0], 0);
      results.push(result);
    } else {
      // 2건 이상일 때만 병렬 (브라우저 시작 시차 0~1초)
      const promises = requests.map((request, index) => {
        const randomDelayMs = Math.random() * 1000;
        return new Promise<ParallelRankResult>((resolve) => {
          setTimeout(async () => {
            const result = await this.checkSingleUrl(request, index);
            resolve(result);
          }, randomDelayMs);
        });
      });
      const resolved = await Promise.all(promises);
      results.push(...resolved);
    }

    const totalDuration = Date.now() - startTime;
    console.log(
      `\n✅ 모든 체크 완료: ${Math.round(totalDuration / 1000)}초`
    );

    return results;
  }

  /**
   * 워커 풀 방식으로 순위 체크 (각 워커 독립적 생명주기)
   *
   * @param requests - 순위 체크 요청 배열
   * @param numWorkers - 동시 실행 워커 수 (기본 4)
   * @param onResult - 각 결과 완료 시 콜백 (실시간 저장용)
   * @returns 모든 결과 배열
   */
  async checkUrlsWithWorkerPool(
    requests: ParallelRankRequest[],
    numWorkers: number = 4,
    onResult?: (result: ParallelRankResult, index: number) => Promise<void>
  ): Promise<ParallelRankResult[]> {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔄 워커 풀 순위 체크 시작`);
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
    console.log(`✅ 워커 풀 완료`);
    console.log(`   ⏱️  총 ${Math.round(totalDuration / 1000)}초 (평균 ${avgPerItem}초/건)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    return results;
  }
}
