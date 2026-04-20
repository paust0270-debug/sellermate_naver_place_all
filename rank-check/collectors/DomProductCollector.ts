import type { Page } from 'puppeteer';
import type { IProductCollector } from '../core/interfaces';
import type { ProductEntry } from '../core/types';

const SCROLL_STEPS = 18; // 원래 값으로 복원
const SCROLL_GAP_MS = 100; // 150 → 100 (33% 추가 감소, 총 60% 감소)

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * DOM 기반 상품 수집기
 *
 * 페이지의 DOM을 직접 파싱하여 상품 목록 수집
 * 1페이지 수집에 적합 (스크롤로 lazy loading 처리)
 */
export class DomProductCollector implements IProductCollector {
  readonly name = 'DomProductCollector';

  async collect(page: Page, pageNumber: number): Promise<ProductEntry[]> {
    // 스크롤로 lazy loading 트리거
    await this.hydrateCurrentPage(page);

    const result = await page.$$eval(
      'a[data-shp-contents-id][data-shp-contents-rank]',
      (anchors, pageNum) => {
        const seen = new Set();
        const products: any[] = [];

        for (const anchor of anchors) {
          const mid = anchor.getAttribute("data-shp-contents-id");
          const rankAttr = anchor.getAttribute("data-shp-contents-rank");
          if (!mid || !rankAttr) continue;

          const totalRank = parseInt(rankAttr, 10);
          if (!Number.isFinite(totalRank)) continue;
          if (seen.has(mid)) continue;

          // Extract organic rank
          let organicRank = -1;
          const dtl = anchor.getAttribute("data-shp-contents-dtl");
          if (dtl) {
            try {
              const normalized = dtl.replace(/&quot;/g, '"');
              const parsed = JSON.parse(normalized);
              if (Array.isArray(parsed)) {
                const organic = parsed.find((item) => item && item.key === "organic_expose_order");
                if (organic) {
                  const val = parseInt(String(organic.value), 10);
                  if (Number.isFinite(val)) {
                    organicRank = val;
                  }
                }
              }
            } catch (e) {
              // ignore
            }
          }

          // Extract product name
          let productName = "상품명 없음";
          const titleAttr = anchor.getAttribute("title") || anchor.getAttribute("aria-label");
          if (titleAttr) {
            productName = titleAttr.trim();
          } else {
            // 부모 요소에서 상품 카드 찾기
            let parent: Element | null = anchor;
            for (let i = 0; i < 5 && parent; i++) {
              parent = parent.parentElement;
              if (!parent) break;

              const cls = parent.className || '';
              if (cls.includes('product_item') || cls.includes('basicList_item') || cls.includes('adProduct_item')) {
                const titleSelectors = [
                  '.product_title__Mmw2K',
                  '[class*="product_title"]',
                  '[class*="product_name"]',
                  '[class*="basicList_title"]',
                  '[class*="title"]',
                  'strong',
                ];
                for (const sel of titleSelectors) {
                  const found = parent.querySelector(sel);
                  if (found) {
                    const text = found.getAttribute('title') || found.textContent;
                    if (text && text.trim().length > 3) {
                      productName = text.replace(/\s+/g, " ").trim().substring(0, 100);
                      break;
                    }
                  }
                }
                break;
              }
            }

            if (productName === "상품명 없음") {
              const titleEl = anchor.querySelector('.product_title__Mmw2K, [class*="title"], strong');
              if (titleEl && titleEl.textContent) {
                productName = titleEl.textContent.replace(/\s+/g, " ").trim();
              }
            }
          }

          const inventory = anchor.getAttribute("data-shp-inventory") || "";
          const isAd = /lst\*(A|P|D)/.test(inventory);

          products.push({
            mid,
            productName,
            totalRank,
            organicRank: organicRank >= 0 ? organicRank : -1,
            isAd,
            pagePosition: 0,
          });

          seen.add(mid);
        }

        // 정렬 및 pagePosition 설정
        products.sort((a, b) => a.totalRank - b.totalRank);
        for (let i = 0; i < products.length; i++) {
          products[i].pagePosition = i + 1;
          if (products[i].organicRank < 0 && !products[i].isAd) {
            products[i].organicRank = products[i].totalRank;
          }
        }

        return products;
      },
      pageNumber
    );

    return result as ProductEntry[];
  }

  private async hydrateCurrentPage(page: Page): Promise<void> {
    await page.evaluate(() => window.scrollTo(0, 0));
    for (let step = 0; step < SCROLL_STEPS; step++) {
      await page.evaluate(() => window.scrollBy(0, 550));
      await delay(SCROLL_GAP_MS);
    }
    await delay(150); // 300 → 150 (50% 추가 감소, 총 75% 감소)
  }
}
