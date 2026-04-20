import type { IMidExtractor } from '../core/interfaces';

/**
 * Fallback MID 추출기
 *
 * 다른 추출기가 모두 실패했을 때 사용
 * 경로에서 10자리 이상 숫자를 추출
 */
export class FallbackExtractor implements IMidExtractor {
  readonly name = 'FallbackExtractor';

  canHandle(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return /\/\d{10,}/.test(urlObj.pathname);
    } catch {
      return false;
    }
  }

  extract(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const match = urlObj.pathname.match(/\/(\d{10,})/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }
}
