#!/usr/bin/env npx tsx
/**
 * 특정 MID의 현재 순위 확인 (페이지 넘기기 포함)
 */

import "dotenv/config";
import { connect } from "puppeteer-real-browser";

const KEYWORD = process.argv[2] || "장난감";
const TARGET_MID = process.argv[3] || "21435512812";
const MAX_PAGES = 15; // 최대 15페이지까지 확인

async function main() {
  console.log(`🔍 키워드: ${KEYWORD}`);
  console.log(`🎯 타겟 MID: ${TARGET_MID}\n`);

  const { browser, page } = await connect({
    headless: false,
    turnstile: true,
  });

  try {
    // 네이버 메인 → 검색
    await page.goto("https://www.naver.com/");
    await new Promise((r) => setTimeout(r, 1500));

    const searchInput = await page.$('input[name="query"]');
    await searchInput?.click();
    await page.keyboard.type(KEYWORD, { delay: 80 });
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 3000));

    // 쇼핑 더보기 클릭
    await page.evaluate(() => {
      const link = document.querySelector('a[href*="search.shopping.naver.com"]');
      if (link) {
        link.removeAttribute("target");
        (link as HTMLAnchorElement).click();
      }
    });
    await new Promise((r) => setTimeout(r, 4000));

    console.log(`URL: ${page.url()}\n`);

    // CAPTCHA 확인
    const blocked = await page.evaluate(() =>
      document.body.innerText.includes("보안 확인")
    );
    if (blocked) {
      console.log("❌ CAPTCHA!");
      await browser.close();
      return;
    }

    let allMids: string[] = [];
    let foundRank = -1;

    // 페이지별로 순회
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      console.log(`📄 ${pageNum}페이지 확인 중...`);

      // 현재 페이지 스크롤해서 모든 상품 로드
      for (let scroll = 0; scroll < 5; scroll++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await new Promise((r) => setTimeout(r, 500));
      }

      // 페이지의 모든 MID 수집
      const mids = await page.evaluate(() => {
        const results: string[] = [];
        const links = Array.from(document.querySelectorAll("a"));

        for (const link of links) {
          const href = link.href || "";
          const patterns = [
            /nv_mid=(\d+)/,
            /nvMid=(\d+)/,
            /product\?p=(\d+)/,
            /catalog\/(\d+)/,
            /products\/(\d+)/,
          ];
          for (const p of patterns) {
            const match = href.match(p);
            if (match && !results.includes(match[1])) {
              results.push(match[1]);
            }
          }
        }
        return results;
      });

      const newMids = mids.filter((m) => !allMids.includes(m));
      allMids.push(...newMids);

      console.log(`   ${newMids.length}개 상품 (누적 ${allMids.length}개)`);

      // 타겟 MID 찾기
      const idx = allMids.indexOf(TARGET_MID);
      if (idx >= 0) {
        foundRank = idx + 1;
        console.log(`\n✅ MID ${TARGET_MID} 발견!`);
        console.log(`   현재 순위: ${foundRank}위 (${pageNum}페이지)`);
        break;
      }

      // 다음 페이지 버튼 클릭 (페이지 번호 직접 클릭)
      if (pageNum < MAX_PAGES) {
        const hasNext = await page.evaluate((nextPage: number) => {
          // 페이지 번호 버튼 찾기
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

          // next 버튼 찾기
          const nextSelectors = ['.pagination_next__pZuC6', 'a[class*="next"]'];
          for (const sel of nextSelectors) {
            const nextBtn = document.querySelector(sel);
            if (nextBtn && !(nextBtn as HTMLElement).classList.contains('pagination_disabled')) {
              (nextBtn as HTMLElement).click();
              return true;
            }
          }
          return false;
        }, pageNum + 1);

        if (!hasNext) {
          console.log(`\n마지막 페이지 도달 (${pageNum}페이지)`);
          break;
        }

        // 페이지 전환 대기
        await new Promise((r) => setTimeout(r, 2500));

        // CAPTCHA 재확인
        const blockedAgain = await page.evaluate(() =>
          document.body.innerText.includes("보안 확인")
        );
        if (blockedAgain) {
          console.log("❌ CAPTCHA 발동!");
          break;
        }
      }
    }

    if (foundRank < 0) {
      console.log(`\n❌ MID ${TARGET_MID} 못 찾음`);
      console.log(`   총 ${allMids.length}개 확인 → ${allMids.length}위 밖`);
    }

    await browser.close();
  } catch (e: any) {
    console.error("에러:", e.message);
    await browser.close();
  }
}

main();
