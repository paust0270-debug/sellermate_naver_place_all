import type { Page } from 'puppeteer';
import type { INavigator } from '../core/interfaces';

const SAFE_DELAY_MS = 2000; // 3000 → 2000 (33% 추가 감소, 총 60% 감소)

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 쇼핑탭 네비게이터
 *
 * 네이버 메인 → 검색 → 쇼핑탭 진입을 담당
 */
export class ShoppingTabNavigator implements INavigator {
  async enterShoppingTab(page: Page, keyword: string): Promise<boolean> {
    console.log("🧭 네이버 메인 진입");

    // 1. 네이버 메인 페이지 이동
    try {
      await page.goto("https://www.naver.com/", {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
    } catch (error) {
      console.log("⚠️ 네이버 진입 실패", error);
      return false;
    }

    await delay(SAFE_DELAY_MS);

    // 2. 검색어 입력
    const searchInput = await page.waitForSelector('input[name="query"]', { timeout: 15000 }).catch(() => null);
    if (!searchInput) {
      console.log("❌ 검색 입력창을 찾을 수 없습니다.");
      return false;
    }

    await searchInput.click({ clickCount: 3 });
    await page.keyboard.type(keyword, { delay: 70 });
    await page.keyboard.press("Enter");

    // 3. 검색 결과 페이지 대기
    console.log("⏳ 검색 결과 대기 중...");
    try {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch {
      // SPA라서 네비게이션 이벤트 없을 수 있음
    }
    await delay(1000); // 2000 → 1000 (50% 추가 감소, 총 67% 감소)

    // 4. 쇼핑탭 클릭
    console.log("🛒 쇼핑탭으로 이동");
    let clicked = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      clicked = await page.evaluate(() => {
        const link = document.querySelector<HTMLAnchorElement>('a[href*="search.shopping.naver.com"]');
        if (!link) return false;
        link.removeAttribute("target");
        link.click();
        return true;
      });
      if (clicked) break;
      console.log(`   ⏳ 쇼핑탭 대기 중... (${attempt}/5)`);
      await delay(1000); // 2000 → 1000 (50% 감소)
    }

    if (!clicked) {
      console.log("❌ 쇼핑탭 링크가 없습니다.");
      return false;
    }

    await delay(SAFE_DELAY_MS + 300); // 500 → 300 (40% 추가 감소)

    // 5. 쇼핑탭 URL 확인
    if (!page.url().includes("search.shopping.naver.com")) {
      console.log("⚠️ 쇼핑탭 URL이 확인되지 않았습니다.");
      return false;
    }

    return true;
  }

  async goToPage(page: Page, targetPage: number): Promise<boolean> {
    // HybridProductCollector가 페이지 이동을 처리하므로 여기선 미사용
    return true;
  }
}
