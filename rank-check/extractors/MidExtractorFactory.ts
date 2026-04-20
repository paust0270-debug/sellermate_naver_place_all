import type { IMidExtractor } from '../core/interfaces';
import type { MidExtractionResult } from '../core/types';
import { QueryParamExtractor } from './QueryParamExtractor';
import { SmartStoreExtractor } from './SmartStoreExtractor';
import { CatalogExtractor } from './CatalogExtractor';
import { FallbackExtractor } from './FallbackExtractor';

/**
 * MID 추출기 팩토리 (OCP 준수)
 *
 * 새로운 URL 패턴이 추가되면:
 * 1. IMidExtractor를 구현하는 새 클래스 생성
 * 2. registerExtractor()로 등록
 *
 * 기존 코드 수정 불필요!
 */
export class MidExtractorFactory {
  private extractors: IMidExtractor[] = [];

  constructor() {
    // 기본 추출기 등록 (우선순위 순서)
    this.registerExtractor(new QueryParamExtractor());
    this.registerExtractor(new SmartStoreExtractor());
    this.registerExtractor(new CatalogExtractor());
    this.registerExtractor(new FallbackExtractor());
  }

  /**
   * 새 추출기 등록 (OCP: 확장에 열려있음)
   */
  registerExtractor(extractor: IMidExtractor): void {
    this.extractors.push(extractor);
  }

  /**
   * 특정 위치에 추출기 삽입 (우선순위 조절)
   */
  insertExtractor(extractor: IMidExtractor, index: number): void {
    this.extractors.splice(index, 0, extractor);
  }

  /**
   * URL에서 MID 추출
   * 등록된 추출기를 순서대로 시도
   */
  extract(url: string): MidExtractionResult {
    for (const extractor of this.extractors) {
      if (extractor.canHandle(url)) {
        const mid = extractor.extract(url);
        if (mid) {
          return {
            mid,
            source: this.getSourceType(extractor.name),
            originalUrl: url,
          };
        }
      }
    }

    return {
      mid: null,
      source: 'failed',
      originalUrl: url,
    };
  }

  private getSourceType(name: string): MidExtractionResult['source'] {
    switch (name) {
      case 'QueryParamExtractor':
        return 'query-param';
      case 'SmartStoreExtractor':
        return 'smartstore';
      case 'CatalogExtractor':
        return 'catalog';
      case 'FallbackExtractor':
        return 'fallback';
      default:
        return 'failed';
    }
  }
}

// 싱글톤 인스턴스 (편의성)
export const midExtractorFactory = new MidExtractorFactory();

/**
 * 간편 함수 (기존 extractMidFromUrl과 호환)
 */
export function extractMid(url: string): string | null {
  return midExtractorFactory.extract(url).mid;
}
