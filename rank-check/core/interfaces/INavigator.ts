import type { Page } from 'puppeteer';

/**
 * 네비게이션 인터페이스
 *
 * 쇼핑탭 진입, 페이지 이동 등 브라우저 네비게이션 담당
 */
export interface INavigator {
  /** 쇼핑탭으로 진입 */
  enterShoppingTab(page: Page, keyword: string): Promise<boolean>;

  /** 특정 페이지로 이동 */
  goToPage(page: Page, targetPage: number): Promise<boolean>;
}

/**
 * 페이지네이션 네비게이터 인터페이스
 */
export interface IPaginationNavigator {
  /** 다음 페이지로 이동하고 API 응답 대기 */
  navigateToPage(page: Page, targetPage: number): Promise<boolean>;
}
