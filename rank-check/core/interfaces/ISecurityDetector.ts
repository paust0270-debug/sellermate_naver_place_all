import type { Page } from 'puppeteer';

/**
 * 보안 감지기 인터페이스
 *
 * CAPTCHA, IP 차단 등 보안 관련 감지
 */
export interface ISecurityDetector {
  /** 현재 페이지가 차단되었는지 확인 */
  isBlocked(page: Page): Promise<boolean>;

  /** 감지기 이름 (디버깅용) */
  readonly name: string;
}
