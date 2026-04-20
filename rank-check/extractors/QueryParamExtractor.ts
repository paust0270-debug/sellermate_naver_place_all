import type { IMidExtractor } from '../core/interfaces';

/**
 * 쿼리 파라미터에서 MID 추출
 *
 * 지원 패턴:
 * - ?mid=12345
 * - ?nvMid=12345
 */
export class QueryParamExtractor implements IMidExtractor {
  readonly name = 'QueryParamExtractor';

  canHandle(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.searchParams.has('mid') || urlObj.searchParams.has('nvMid');
    } catch {
      return false;
    }
  }

  extract(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.searchParams.get('mid') || urlObj.searchParams.get('nvMid');
    } catch {
      return null;
    }
  }
}
