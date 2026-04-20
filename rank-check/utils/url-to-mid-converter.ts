/**
 * URL → MID 변환 통합 유틸리티
 *
 * URL에서 MID를 추출하는 통합 함수를 제공합니다.
 * 빠른 경로 (direct extraction)를 먼저 시도하고,
 * 실패 시 스마트스토어 → 카탈로그 MID 변환을 시도합니다.
 */

// Page 타입: Puppeteer/Playwright 모두 호환 (any 사용)
type Page = any;
import { extractMidFromUrl } from './extractMidFromUrl';
import { getCatalogMidFromUrl, isSmartStoreUrl } from './getCatalogMidFromUrl';

export interface MidExtractionResult {
  mid: string | null;
  source: 'direct' | 'catalog' | 'failed' | 'captcha_failed';
  originalUrl: string;
}

/**
 * URL에서 MID를 추출합니다.
 *
 * @param url - 상품 URL
 * @param page - (선택) Puppeteer Page 객체 (스마트스토어 변환 시 필요)
 * @returns MID 추출 결과
 *
 * @example
 * // Direct extraction (브라우저 불필요)
 * const result = await urlToMid('https://smartstore.naver.com/store/products/123');
 * // { mid: '123', source: 'direct', originalUrl: '...' }
 *
 * @example
 * // Catalog conversion (브라우저 필요)
 * const result = await urlToMid('https://smartstore.naver.com/store/products/123', page);
 * // { mid: '89476501205', source: 'catalog', originalUrl: '...' }
 */
export async function urlToMid(
  url: string,
  page?: Page
): Promise<MidExtractionResult> {
  // 스마트스토어 URL은 무조건 카탈로그 MID 변환 필요
  if (isSmartStoreUrl(url) && page) {
    console.log(`   🔄 스마트스토어 URL → 카탈로그 MID 변환 중...`);
    const catalogResult = await getCatalogMidFromUrl(page, url);

    if (catalogResult.mid) {
      return {
        mid: catalogResult.mid,
        source: 'catalog',
        originalUrl: url,
      };
    }

    // 캡챠 실패 시 → 재시도 큐로 (상품 ID 직접 검색 안 함)
    if (catalogResult.captchaFailed) {
      console.log(`   🔄 캡챠 실패 → pending으로 재시도 예정`);
      return {
        mid: null,
        source: 'captcha_failed',
        originalUrl: url,
      };
    }

    // 카탈로그 MID 없음 (캡챠 아닌 경우) → 스마트스토어 상품 ID로 직접 검색
    const directMid = extractMidFromUrl(url);
    if (directMid) {
      console.log(`   ℹ️  카탈로그 미등록 상품 → 상품 ID로 검색: ${directMid}`);
      return {
        mid: directMid,
        source: 'direct',
        originalUrl: url,
      };
    }
  }

  // 카탈로그 URL 등: Direct MID extraction
  const directMid = extractMidFromUrl(url);
  if (directMid) {
    return {
      mid: directMid,
      source: 'direct',
      originalUrl: url,
    };
  }

  // Failed
  return {
    mid: null,
    source: 'failed',
    originalUrl: url,
  };
}
