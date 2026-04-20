#!/usr/bin/env npx tsx
/**
 * 특정 MID의 현재 순위 확인 (리스트형 보기)
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
  console.log(`🎯 타겟 MID: ${TARGET_MID}`);
  console.log(`📋 보기 모드: 리스트형\n`);

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

    // 리스트형 보기로 변경
    console.log(`리스트형 보기로 전환 중...`);
    const listViewChanged = await page.evaluate(() => {
      // 리스트 보기 버튼 찾기
      const listButton = document.querySelector('button[class*="list"]');
      if (listButton) {
        (listButton as HTMLElement).click();
        return true;
      }
      return false;
    });

    if (listViewChanged) {
      console.log(`✓ 리스트형으로 전환 완료\n`);
      await delay(2000);
    } else {
      console.log(`⚠️ 리스트 버튼 못 찾음 (이미 리스트형일 수 있음)\n`);
    }

    let allMids: string[] = [];
    let foundRank = -1;
    const MAX_PAGES = 15;

    // 페이지별로 확인
    for (let currentPage = 1; currentPage <= MAX_PAGES; currentPage++) {
      // 페이지네이션이 나타날 때까지 스크롤
      let lastHeight = 0;
      let sameHeightCount = 0;

      for (let scroll = 0; scroll < 100; scroll++) { // 최대 100번
        await page.evaluate(() => window.scrollBy(0, 800));
        await delay(400);

        // 페이지네이션 버튼이 보이는지 확인
        const paginationVisible = await page.evaluate(() => {
          const pagination = document.querySelector('[class*="pagination"]');
          if (!pagination) return false;
          const rect = pagination.getBoundingClientRect();
          return rect.top < window.innerHeight;
        });

        if (paginationVisible) {
          console.log(`   → 페이지네이션 도달 (${scroll + 1}번 스크롤)`);
          break;
        }

        // 더 이상 스크롤되지 않으면 중단
        const currentHeight = await page.evaluate(() => document.body.scrollHeight);
        if (currentHeight === lastHeight) {
          sameHeightCount++;
          if (sameHeightCount >= 3) {
            console.log(`   → 스크롤 끝 (${scroll + 1}번 스크롤)`);
            break;
          }
        } else {
          sameHeightCount = 0;
        }
        lastHeight = currentHeight;
      }

      // MID 추출
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

        // 타겟 MID 찾기
        const idx = mids.indexOf(mid);
        if (idx !== -1) {
          const rank = (pageNum - 1) * 40 + idx + 1;
          return { found: true, rank, pageRank: idx + 1, total: mids.length };
        }

        return { found: false, rank: null, pageRank: null, total: mids.length };
      }, TARGET_MID, currentPage);

      const newMids = result.total;
      console.log(`${currentPage}페이지: ${newMids}개 상품`);

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
          console.log(`\n→ ${currentPage}페이지까지만 존재`);
          break;
        }

        await delay(2500);
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
