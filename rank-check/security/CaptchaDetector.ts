import type { Page } from 'puppeteer';
import type { ISecurityDetector } from '../core/interfaces';

/**
 * CAPTCHA/차단 감지기
 *
 * 네이버의 보안 페이지 감지
 */
export class CaptchaDetector implements ISecurityDetector {
  readonly name = 'CaptchaDetector';

  private blockedKeywords = [
    "보안 확인",
    "자동 입력 방지",
    "일시적으로 제한",
    "비정상적인 접근",
    "로봇이 아닙니다",
  ];

  async isBlocked(page: Page): Promise<boolean> {
    return page.evaluate((keywords) => {
      const bodyText = document.body?.innerText ?? "";
      return keywords.some(keyword => bodyText.includes(keyword));
    }, this.blockedKeywords);
  }

  /**
   * 차단 키워드 추가 (확장 가능)
   */
  addBlockedKeyword(keyword: string): void {
    this.blockedKeywords.push(keyword);
  }
}
