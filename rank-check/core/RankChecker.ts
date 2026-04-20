import type { Page } from 'puppeteer';
import type { IRankChecker, IProductCollector, INavigator, ISecurityDetector } from './interfaces';
import type { RankResult, RankCheckOptions, ProductEntry } from './types';

const DEFAULT_MAX_PAGES = 15;
const SAFE_DELAY_MS = 1500; // 2500 → 1500 (40% 추가 감소, 총 70% 감소)

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 순위 체커 (조율자 역할)
 *
 * SRP: 순위 체크 흐름만 조율
 * DIP: 구현이 아닌 인터페이스에 의존
 *
 * @example
 * const checker = new RankChecker(
 *   new ShoppingTabNavigator(),
 *   new HybridProductCollector(),
 *   new CaptchaDetector()
 * );
 * const result = await checker.findRank(page, "키워드", "12345");
 */
export class RankChecker implements IRankChecker {
  constructor(
    private navigator: INavigator,
    private collector: IProductCollector,
    private securityDetector: ISecurityDetector
  ) {}

  async findRank(
    page: Page,
    keyword: string,
    targetMid: string,
    options?: RankCheckOptions
  ): Promise<RankResult | null> {
    const normalizedKeyword = keyword.trim();
    const normalizedMid = targetMid.trim();
    const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;

    if (!normalizedKeyword || !normalizedMid) {
      console.log("⚠️ 키워드 또는 MID가 비어 있습니다.");
      return null;
    }

    console.log(`🔍 "${normalizedKeyword}" / MID ${normalizedMid} 순위 추적 (최대 ${maxPages}페이지)`);

    // 1. 쇼핑탭 진입
    const shoppingReady = await this.navigator.enterShoppingTab(page, normalizedKeyword);
    if (!shoppingReady) {
      console.log("❌ 쇼핑탭 진입에 실패했습니다.");
      return null;
    }

    // 2. 보안 체크
    if (await this.securityDetector.isBlocked(page)) {
      console.log("🛑 보안 페이지 감지됨 (CAPTCHA)");
      return null;
    }

    // 3. 페이지별 상품 수집 및 매칭
    for (let currentPage = 1; currentPage <= maxPages; currentPage++) {
      const products = await this.collector.collect(page, currentPage);

      if (products.length === 0) {
        console.log(`   ⚠️ ${currentPage}페이지 수집 실패, 다음 페이지로...`);
        continue;
      }

      // MID 매칭
      const match = this.findMatchingProduct(products, normalizedMid);
      if (match) {
        console.log(
          `✅ 순위 발견: 전체 ${match.totalRank}위 / 오가닉 ${match.organicRank > 0 ? match.organicRank : "-"}`
        );
        return {
          found: true,
          mid: match.mid,
          productName: match.productName,
          totalRank: match.totalRank,
          organicRank: match.organicRank,
          isAd: match.isAd,
          page: currentPage,
          pagePosition: match.pagePosition,
        };
      }

      // 보안 체크
      if (await this.securityDetector.isBlocked(page)) {
        console.log("🛑 페이지 이동 중 보안 페이지 감지");
        return null;
      }

      await delay(SAFE_DELAY_MS);
    }

    console.log(`❌ ${normalizedMid}을(를) ${maxPages}페이지 내에서 찾지 못했습니다.`);
    return null;
  }

  private findMatchingProduct(products: ProductEntry[], targetMid: string): ProductEntry | undefined {
    return products.find(item => item.mid === targetMid);
  }
}
