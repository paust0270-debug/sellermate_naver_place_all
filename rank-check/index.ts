/**
 * Rank-Check 모듈 Public API
 *
 * 기존 코드와 완벽한 호환성 유지
 *
 * @example
 * // 기존 방식 (호환)
 * import { findAccurateRank } from './rank-check';
 * const result = await findAccurateRank(page, keyword, mid);
 *
 * @example
 * // 새 방식 (DI)
 * import { RankChecker, ShoppingTabNavigator, HybridProductCollector, CaptchaDetector } from './rank-check';
 * const checker = new RankChecker(
 *   new ShoppingTabNavigator(),
 *   new HybridProductCollector(),
 *   new CaptchaDetector()
 * );
 * const result = await checker.findRank(page, keyword, mid);
 */

import type { Page } from 'puppeteer';

// Core exports
export * from './core';

// Module exports
export * from './extractors';
export * from './collectors';
export * from './navigation';
export * from './security';

// 기존 코드 호환을 위한 re-export
export { RankResult, ProductEntry, RankCheckOptions } from './core/types';

// ==============================================
// 기존 findAccurateRank와 완벽 호환되는 함수
// ==============================================

import { RankChecker } from './core/RankChecker';
import { ShoppingTabNavigator } from './navigation/ShoppingTabNavigator';
import { HybridProductCollector } from './collectors/HybridProductCollector';
import { CaptchaDetector } from './security/CaptchaDetector';
import type { RankResult } from './core/types';

// 기본 인스턴스 (싱글톤)
const defaultNavigator = new ShoppingTabNavigator();
const defaultCollector = new HybridProductCollector();
const defaultSecurityDetector = new CaptchaDetector();
const defaultRankChecker = new RankChecker(
  defaultNavigator,
  defaultCollector,
  defaultSecurityDetector
);

/**
 * 기존 accurate-rank-checker.ts와 100% 호환되는 함수
 *
 * @deprecated 새 코드에서는 RankChecker 클래스 사용 권장
 */
export async function findAccurateRank(
  page: Page,
  keyword: string,
  targetMid: string,
  maxPages = 15
): Promise<RankResult | null> {
  return defaultRankChecker.findRank(page, keyword, targetMid, { maxPages });
}

/**
 * 커스텀 설정으로 RankChecker 생성
 */
export function createRankChecker(options?: {
  apiTimeout?: number;
}) {
  const navigator = new ShoppingTabNavigator();
  const collector = new HybridProductCollector(options?.apiTimeout);
  const securityDetector = new CaptchaDetector();

  return new RankChecker(navigator, collector, securityDetector);
}
