import type { IMidExtractor } from '../core/interfaces';

/**
 * 스마트스토어 URL에서 MID 추출
 *
 * 지원 패턴:
 * - https://smartstore.naver.com/{storeId}/products/{MID}
 */
export class SmartStoreExtractor implements IMidExtractor {
  readonly name = 'SmartStoreExtractor';

  canHandle(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('smartstore.naver.com') &&
             urlObj.pathname.includes('/products/');
    } catch {
      return false;
    }
  }

  extract(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const match = urlObj.pathname.match(/\/products\/(\d+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }
}
