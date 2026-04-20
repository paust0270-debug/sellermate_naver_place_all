/**
 * Rank-Check 공통 타입 정의
 */

/** 상품 정보 */
export interface ProductEntry {
  mid: string;
  productName: string;
  totalRank: number;
  organicRank: number;
  isAd: boolean;
  pagePosition: number;
}

/** 순위 검색 결과 */
export interface RankResult {
  found: boolean;
  mid: string;
  productName: string;
  totalRank: number;
  organicRank: number;
  isAd: boolean;
  page: number;
  pagePosition: number;
}

/** 페이지 스캔 결과 */
export interface PageScanResult {
  products: ProductEntry[];
  firstMid: string | null;
  firstRank: number | null;
}

/** 순위 체크 옵션 */
export interface RankCheckOptions {
  maxPages?: number;
  delayMs?: number;
  timeout?: number;
}

/** 수집 전략 타입 */
export type CollectorStrategy = 'dom' | 'api' | 'hybrid';

/** MID 추출 결과 */
export interface MidExtractionResult {
  mid: string | null;
  source: 'query-param' | 'smartstore' | 'catalog' | 'fallback' | 'failed';
  originalUrl: string;
}
