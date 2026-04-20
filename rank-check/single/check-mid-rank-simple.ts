#!/usr/bin/env npx tsx
/**
 * 특정 MID의 현재 순위 확인 (배치 스크립트 패턴 적용)
 *
 * 핵심 개선:
 * - 배치 스크립트와 동일한 로직 사용
 * - 복잡한 AJAX 감지 제거
 * - 단순 스크롤 + 추출 + 클릭 + 대기
 */

import "dotenv/config";
import { connect } from "puppeteer-real-browser";

const KEYWORD = process.argv[2] || "장난감";
const TARGET_MID = process.argv[3] || "54912883604";

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log(`🔍 키워드: ${KEYWORD}`);
  console.log(`🎯 타겟 MID: ${TARGET_MID}\n`);

  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  try {
    // 네이버 → 검색 → 쇼핑
    await page.goto("https://www.naver.com/");
    await delay(1500);

    const searchInput = await page.$('input[name="query"]');
    await searchInput!.click();
    await page.keyboard.type(KEYWORD, { delay: 50 });
    await page.keyboard.press("Enter");
    await delay(3000);

    await page.evaluate(() => {
      const link = document.querySelector('a[href*="search.shopping.naver.com"]');
      if (link) {
        link.removeAttribute("target");
        (link as HTMLAnchorElement).click();
      }
    });
    await delay(4000);

    console.log(`쇼핑탭 진입 완료\n`);

    let foundRank = -1;
    const MAX_PAGES = 15;
    let currentPage = 1;

    // 페이지별로 확인
    while (currentPage <= MAX_PAGES) {
      // 배치 스크립트처럼: 스크롤해서 모든 상품 로드
      for (let s = 0; s < 10; s++) {
        await page.evaluate(() => window.scrollBy(0, 500));
        await delay(300);
      }

      // MID 추출 및 검색
      const result = await page.evaluate((mid: string, pageNum: number) => {
        const mids: string[] = [];
        const patterns = [/nv_mid[=:](\d+)/, /nvMid[=:](\d+)/, /products\/(\d+)/, /catalog\/(\d+)/];

        document.querySelectorAll("a").forEach((a) => {
          const href = (a as HTMLAnchorElement).href || "";
          for (const p of patterns) {
            const m = href.match(p);
            if (m && !mids.includes(m[1])) {
              mids.push(m[1]);
              break;
            }
          }
        });

        const idx = mids.indexOf(mid);
        if (idx !== -1) {
          const rank = (pageNum - 1) * 40 + idx + 1;
          return { found: true, rank, pageRank: idx + 1, total: mids.length };
        }

        return { found: false, rank: null, pageRank: null, total: mids.length };
      }, TARGET_MID, currentPage);

      console.log(`${currentPage}페이지: ${result.total}개 상품 확인`);

      if (result.found && result.rank) {
        console.log(`\n✅ MID ${TARGET_MID} 발견!`);
        console.log(`   현재 순위: ${result.rank}위 (${currentPage}페이지 ${result.pageRank}번째)`);
        foundRank = result.rank;
        break;
      }

      // 다음 페이지로 (배치 스크립트와 동일)
      const nextClicked = await page.evaluate((nextPage: number) => {
        const selectors = [
          '.pagination_num__B3C28',
          'a[class*="pagination"]',
          'a[href*="pagingIndex"]'
        ];

        for (const sel of selectors) {
          const buttons = document.querySelectorAll(sel);
          for (const btn of buttons) {
            if (btn.textContent?.trim() === String(nextPage)) {
              (btn as HTMLElement).click();
              return true;
            }
          }
        }

        const nextSelectors = ['.pagination_next__pZuC6', 'a[class*="next"]'];
        for (const sel of nextSelectors) {
          const nextBtn = document.querySelector(sel);
          if (nextBtn && !(nextBtn as HTMLElement).classList.contains('pagination_disabled__qUdaH')) {
            (nextBtn as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, currentPage + 1);

      if (!nextClicked) {
        console.log(`\n→ ${currentPage}페이지까지만 존재`);
        break;
      }

      // 배치 스크립트처럼: 단순히 1초 대기 (1500 → 1000, 33% 추가 감소)
      await delay(1000);
      currentPage++;
    }

    if (foundRank < 0) {
      console.log(`\n❌ ${MAX_PAGES}페이지 (${MAX_PAGES * 40}위)까지 순위권 밖`);
    }

    await browser.close();
  } catch (e: any) {
    console.error("에러:", e.message);
    await browser.close();
  }
}

main();
