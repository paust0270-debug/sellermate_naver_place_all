import type { Page } from 'puppeteer';
import type { IProductCollector } from '../core/interfaces';
import type { ProductEntry } from '../core/types';
import { DomProductCollector } from './DomProductCollector';
import { ApiProductCollector } from './ApiProductCollector';

const SAFE_DELAY_MS = 1500; // 2500 → 1500 (40% 추가 감소, 총 70% 감소)

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 하이브리드 상품 수집기 (Strategy + Fallback Pattern)
 *
 * 1페이지: DOM 수집
 * 2페이지 이후: API 수집 → 실패시 DOM 폴백
 */
export class HybridProductCollector implements IProductCollector {
  readonly name = 'HybridProductCollector';

  private domCollector: DomProductCollector;
  private apiCollector: ApiProductCollector;

  constructor(apiTimeout = 25000) { // 45000 → 25000 (44% 감소, API 타임아웃)
    this.domCollector = new DomProductCollector();
    this.apiCollector = new ApiProductCollector(apiTimeout);
  }

  async collect(page: Page, pageNumber: number): Promise<ProductEntry[]> {
    // 1페이지는 DOM 수집 (이미 로드된 상태)
    if (pageNumber === 1) {
      console.log(`📄 ${pageNumber}페이지 상품 수집 (DOM 방식)`);
      return this.domCollector.collect(page, pageNumber);
    }

    // 2페이지 이후: API 시도
    console.log(`📄 ${pageNumber}페이지 상품 수집 (API 방식)`);
    const apiProducts = await this.apiCollector.collect(page, pageNumber);

    if (apiProducts.length > 0) {
      return apiProducts;
    }

    // API 실패시 DOM 폴백
    console.log(`   🔄 DOM 방식으로 재시도 중...`);
    return this.fallbackToDom(page, pageNumber);
  }

  private async fallbackToDom(page: Page, pageNumber: number): Promise<ProductEntry[]> {
    try {
      // URL 직접 변경으로 페이지 이동
      const currentUrl = page.url();
      const newUrl = currentUrl.replace(/pagingIndex=\d+/, `pagingIndex=${pageNumber}`);

      if (newUrl === currentUrl) {
        const separator = currentUrl.includes('?') ? '&' : '?';
        await page.goto(`${currentUrl}${separator}pagingIndex=${pageNumber}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      } else {
        await page.goto(newUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      }

      await delay(SAFE_DELAY_MS);
      const products = await this.domCollector.collect(page, pageNumber);

      if (products.length > 0) {
        console.log(`   ✅ DOM 방식으로 ${products.length}개 상품 수집`);
      }

      return products;
    } catch (error: any) {
      console.log(`   ⚠️ DOM 폴백도 실패: ${error.message}`);
      return [];
    }
  }
}
