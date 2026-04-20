import type { Page } from 'puppeteer';
import type { ProductEntry } from '../types';

/**
 * 상품 수집기 인터페이스 (Strategy Pattern)
 *
 * DOM 기반, API 기반, 하이브리드 등 다양한 수집 전략을 교체 가능
 */
export interface IProductCollector {
  /** 현재 페이지에서 상품 목록 수집 */
  collect(page: Page, pageNumber: number): Promise<ProductEntry[]>;

  /** 수집기 이름 (디버깅용) */
  readonly name: string;
}
