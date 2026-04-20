#!/usr/bin/env npx tsx
/**
 * 특정 MID의 현재 순위 확인
 */

import "dotenv/config";
import { connect } from "puppeteer-real-browser";

const KEYWORD = process.argv[2] || "장난감";
const TARGET_MID = process.argv[3] || "21435512812";

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

    // 스크롤하면서 MID 찾기 (최대 500위까지)
    let allMids: string[] = [];
    let foundRank = -1;
    let lastCount = 0;
    let noNewCount = 0;

    for (let scroll = 0; scroll < 30; scroll++) {
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

      const idx = allMids.indexOf(TARGET_MID);
      if (idx >= 0) {
        foundRank = idx + 1;
        console.log(`\n✅ MID ${TARGET_MID} 발견!`);
        console.log(`   현재 순위: ${foundRank}위 (스크롤 ${scroll + 1})`);
        break;
      }

      if (newMids.length === 0) {
        noNewCount++;
        if (noNewCount >= 5) {
          console.log(`\n더 이상 새 상품 없음 (${allMids.length}개 확인)`);
          break;
        }
      } else {
        noNewCount = 0;
      }

      console.log(`스크롤 ${scroll + 1}: ${allMids.length}개 MID`);
      lastCount = allMids.length;

      await page.evaluate(() => window.scrollBy(0, 1000));
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (foundRank === -1) {
      console.log(`\n❌ MID ${TARGET_MID} 못 찾음`);
      console.log(`   총 ${allMids.length}개 확인 → ${allMids.length}위 밖`);
    }

    await new Promise((r) => setTimeout(r, 3000));
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
