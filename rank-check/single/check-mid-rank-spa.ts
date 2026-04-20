#!/usr/bin/env npx tsx
/**
 * 특정 MID의 현재 순위 확인 (SPA 페이지 전환 대응)
 */

import "dotenv/config";
import { connect } from "puppeteer-real-browser";

const KEYWORD = process.argv[2] || "장난감";
const TARGET_MID = process.argv[3] || "21435512812";

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

    // 페이지별로 확인
    for (let currentPage = 1; currentPage <= MAX_PAGES; currentPage++) {
      // 현재 페이지의 첫 번째 MID 저장 (페이지 전환 확인용)
      const beforeFirstMid = await page.evaluate(() => {
        const patterns = [/nv_mid[=:](\d+)/, /nvMid[=:](\d+)/, /products\/(\d+)/, /catalog\/(\d+)/];
        const links = document.querySelectorAll("a");
        for (const link of links) {
          const href = (link as HTMLAnchorElement).href || "";
          for (const p of patterns) {
            const m = href.match(p);
            if (m) return m[1];
          }
        }
        return null;
      });

      // 페이지네이션이 나타날 때까지 스크롤
      for (let scroll = 0; scroll < 50; scroll++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await delay(300);

        const paginationVisible = await page.evaluate(() => {
          const pagination = document.querySelector('[class*="pagination"]');
          if (!pagination) return false;
          const rect = pagination.getBoundingClientRect();
          return rect.top < window.innerHeight;
        });

        if (paginationVisible) break;
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
          return { found: true, rank, pageRank: idx + 1, total: mids.length, firstMid: mids[0] || null };
        }

        return { found: false, rank: null, pageRank: null, total: mids.length, firstMid: mids[0] || null };
      }, TARGET_MID, currentPage);

      console.log(`${currentPage}페이지: ${result.total}개 (첫 MID: ${result.firstMid?.substring(0, 8)}...)`);

      if (result.found && result.rank) {
        console.log(`\n✅ MID ${TARGET_MID} 발견!`);
        console.log(`   현재 순위: ${result.rank}위 (${currentPage}페이지 ${result.pageRank}번째)`);
        foundRank = result.rank;
        break;
      }

      // 다음 페이지로
      if (currentPage < MAX_PAGES) {
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
          console.log(`\n→ 마지막 페이지`);
          break;
        }

        // DOM 업데이트 대기: 첫 번째 MID가 바뀔 때까지 기다림
        let retries = 0;
        while (retries < 20) {
          await delay(300);
          const afterFirstMid = await page.evaluate(() => {
            const patterns = [/nv_mid[=:](\d+)/, /nvMid[=:](\d+)/, /products\/(\d+)/, /catalog\/(\d+)/];
            const links = document.querySelectorAll("a");
            for (const link of links) {
              const href = (link as HTMLAnchorElement).href || "";
              for (const p of patterns) {
                const m = href.match(p);
                if (m) return m[1];
              }
            }
            return null;
          });

          if (afterFirstMid !== beforeFirstMid) {
            console.log(`   → 페이지 전환 완료 (${retries * 300}ms 대기)`);
            break;
          }
          retries++;
        }

        if (retries >= 20) {
          console.log(`   ⚠️ 페이지 전환 감지 실패`);
        }

        // 스크롤 위치 초기화
        await page.evaluate(() => window.scrollTo(0, 0));
        await delay(500);
      }
    }

    if (foundRank < 0) {
      console.log(`\n❌ 순위권 밖`);
    }

    await browser.close();
  } catch (e: any) {
    console.error("에러:", e.message);
    await browser.close();
  }
}

main();
