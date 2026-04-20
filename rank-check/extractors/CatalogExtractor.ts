import type { IMidExtractor } from '../core/interfaces';

/**
 * 네이버 쇼핑 카탈로그 URL에서 MID 추출
 *
 * 지원 패턴:
 * - https://search.shopping.naver.com/catalog/{MID}
 * - https://shopping.naver.com/catalog/{MID}
 * - https://m.shopping.naver.com/catalog/{MID}
 */
export class CatalogExtractor implements IMidExtractor {
  readonly name = 'CatalogExtractor';

  canHandle(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('shopping.naver.com') &&
             urlObj.pathname.includes('/catalog/');
    } catch {
      return false;
    }
  }

  extract(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const match = urlObj.pathname.match(/\/catalog\/(\d+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }
}
