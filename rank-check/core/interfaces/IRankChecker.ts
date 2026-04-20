import type { Page } from 'puppeteer';
import type { RankResult, RankCheckOptions } from '../types';

/**
 * 순위 체커 인터페이스
 *
 * 전체 순위 체크 흐름을 조율하는 메인 인터페이스
 */
export interface IRankChecker {
  /**
   * 키워드로 검색하여 특정 MID의 순위를 찾음
   *
   * @param page - Puppeteer Page 객체
   * @param keyword - 검색 키워드
   * @param targetMid - 찾을 상품 MID
   * @param options - 옵션 (최대 페이지 등)
   */
  findRank(
    page: Page,
    keyword: string,
    targetMid: string,
    options?: RankCheckOptions
  ): Promise<RankResult | null>;
}
