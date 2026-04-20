/**
 * 브라우저를 사용하여 카탈로그 URL에서 상품명(풀네임) 추출
 *
 * Referer Chain을 사용하여 캡챠 우회
 *
 * @param page - Puppeteer Page 객체
 * @param catalogUrl - 네이버 쇼핑 카탈로그 URL
 * @returns 상품명 풀네임 또는 null
 */
import type { Page } from 'puppeteer';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function getProductNameFromUrlBrowser(
  page: Page,
  catalogUrl: string
): Promise<string | null> {
  try {
    console.log(`\n📦 상품명 추출 중...`);
    console.log(`   URL: ${catalogUrl.substring(0, 80)}...`);

    // Referer Chain (캡챠 방지)
    console.log(`   1️⃣ 네이버 메인 방문`);
    await page.goto("https://www.naver.com", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await delay(2000);

    console.log(`   2️⃣ 쇼핑 검색 페이지 방문 (Referer 생성)`);
    await page.goto("https://search.shopping.naver.com", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await delay(1500);

    console.log(`   3️⃣ 카탈로그 페이지 방문`);
    await page.goto(catalogUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await delay(2000);

    // 캡챠 체크
    const hasBlockPage = await page.evaluate(() => {
      const bodyText = document.body?.innerText ?? "";
      return (
        bodyText.includes("보안 확인") ||
        bodyText.includes("자동 입력 방지") ||
        bodyText.includes("일시적으로 제한")
      );
    });

    if (hasBlockPage) {
      console.log(`   🛑 캡챠 페이지 감지됨`);
      return null;
    }

    // 상품명 추출 (여러 셀렉터 시도)
    const productName = await page.evaluate(() => {
      // 시도 1: h1 태그
      const h1 = document.querySelector('h1');
      if (h1?.textContent?.trim()) {
        return h1.textContent.trim();
      }

      // 시도 2: .product_title 클래스
      const productTitle = document.querySelector('.product_title, [class*="productTitle"], [class*="product_title"]');
      if (productTitle?.textContent?.trim()) {
        return productTitle.textContent.trim();
      }

      // 시도 3: og:title meta 태그
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) {
        const content = ogTitle.getAttribute('content');
        if (content?.trim()) {
          return content.trim();
        }
      }

      // 시도 4: title 태그
      const title = document.title;
      if (title) {
        // " : 네이버 쇼핑" 제거
        const cleaned = title.replace(/\s*:\s*네이버.*$/, '').trim();
        if (cleaned.length > 3) {
          return cleaned;
        }
      }

      return null;
    });

    if (productName) {
      console.log(`   ✅ 상품명 추출 성공: ${productName.substring(0, 50)}...`);
      return productName;
    }

    console.log(`   ⚠️ 상품명을 찾을 수 없습니다`);
    return null;

  } catch (error: any) {
    console.error(`   ❌ 상품명 추출 에러: ${error.message}`);
    return null;
  }
}
