import type { Page } from 'puppeteer';
import type { IProductCollector } from '../core/interfaces';
import type { ProductEntry } from '../core/types';

/**
 * API 인터셉트 기반 상품 수집기
 *
 * 페이지네이션 클릭 시 발생하는 API 응답을 인터셉트하여 수집
 * 2페이지 이후 수집에 적합 (더 빠르고 정확함)
 */
export class ApiProductCollector implements IProductCollector {
  readonly name = 'ApiProductCollector';

  private apiTimeout: number;

  constructor(apiTimeout = 20000) { // 30000 → 20000 (33% 감소, API 응답 대기)
    this.apiTimeout = apiTimeout;
  }

  async collect(page: Page, pageNumber: number): Promise<ProductEntry[]> {
    // 페이지네이션 버튼 확인
    const buttonExists = await page.evaluate((nextPage) => {
      const buttons = Array.from(document.querySelectorAll('a.pagination_btn_page__utqBz, a[class*="pagination_btn"]'));
      for (const btn of buttons) {
        if (btn.textContent?.trim() === String(nextPage)) {
          return true;
        }
      }
      return false;
    }, pageNumber);

    if (!buttonExists) {
      console.log(`⚠️ ${pageNumber}페이지 버튼을 찾지 못했습니다.`);
      return [];
    }

    // API 응답 대기 설정
    const apiResponsePromise = page.waitForResponse(
      (response) => {
        const url = response.url();
        return url.includes('/api/search/all') && url.includes(`pagingIndex=${pageNumber}`);
      },
      { timeout: this.apiTimeout }
    );

    // 페이지네이션 버튼 클릭
    try {
      const pageButton = await page.evaluateHandle((nextPage) => {
        const buttons = Array.from(document.querySelectorAll('a.pagination_btn_page__utqBz, a[class*="pagination_btn"]'));
        for (const btn of buttons) {
          if (btn.textContent?.trim() === String(nextPage)) {
            return btn;
          }
        }
        return null;
      }, pageNumber);

      if (!pageButton) {
        console.log(`⚠️ 버튼 element를 가져올 수 없습니다.`);
        return [];
      }

      await (pageButton.asElement() as any).click();
      console.log(`   버튼 클릭, API 응답 대기 중...`);
    } catch (error) {
      console.log(`   ⚠️ 버튼 클릭 실패: ${error}`);
      return [];
    }

    // API 응답 파싱
    try {
      const response = await apiResponsePromise;
      console.log(`   ✅ API 응답 수신`);

      const json = await response.json();
      if (!json.shoppingResult?.products) {
        console.log(`   ⚠️ API 응답에 products 없음`);
        return [];
      }

      const products: ProductEntry[] = [];
      const apiProducts = json.shoppingResult.products;

      for (let i = 0; i < apiProducts.length; i++) {
        const p = apiProducts[i];
        const mid = p.id || p.nvMid || "";
        const totalRank = p.rank || (pageNumber - 1) * 40 + i + 1;
        const organicRank = p.rankInfo?.organicRank || -1;
        const productName = p.productTitle || p.title || "상품명 없음";
        const isAd = p.adcrType !== undefined && p.adcrType !== null;

        if (mid) {
          products.push({
            mid,
            productName,
            totalRank,
            organicRank: organicRank > 0 ? organicRank : totalRank,
            isAd,
            pagePosition: i + 1,
          });
        }
      }

      console.log(`   수집: ${products.length}개 상품 (${products[0]?.totalRank || "?"}위~${products[products.length - 1]?.totalRank || "?"}위)`);
      return products;

    } catch (error) {
      console.log(`   ⚠️ API 응답 타임아웃 또는 파싱 실패: ${error}`);
      return [];
    }
  }
}
