#!/usr/bin/env npx tsx
/**
 * 특정 MID의 현재 순위 확인 (URL 직접 변경 방식)
 */

import "dotenv/config";
import { connect } from "puppeteer-real-browser";

const KEYWORD = process.argv[2] || "장난감";
const TARGET_MID = process.argv[3] || "21435512812";
const MAX_PAGES = 15;

async function main() {
  console.log(`🔍 키워드: ${KEYWORD}`);
  console.log(`🎯 타겟 MID: ${TARGET_MID}\n`);

  const { browser, page } = await connect({
    headless: false,
    turnstile: true,
  });

  try {
    let allMids: string[] = [];
    let foundRank = -1;

    const encodedKeyword = encodeURIComponent(KEYWORD);

    // 페이지별로 URL 직접 이동
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      const url = `https://search.shopping.naver.com/search/all?query=${encodedKeyword}&frm=NVSCTAB&pagingIndex=${pageNum}`;

      console.log(`📄 ${pageNum}페이지 확인 중...`);
      await page.goto(url, { waitUntil: "networkidle2" });
      await new Promise((r) => setTimeout(r, 2000));

      // CAPTCHA 확인
      const blocked = await page.evaluate(() =>
        document.body.innerText.includes("보안 확인")
      );
      if (blocked) {
        console.log(`❌ CAPTCHA 발동!`);
        break;
      }

      // 스크롤해서 모든 상품 로드
      for (let scroll = 0; scroll < 5; scroll++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await new Promise((r) => setTimeout(r, 300));
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

      // 상품이 없으면 마지막 페이지
      if (newMids.length === 0) {
        console.log(`\n마지막 페이지 도달 (${pageNum}페이지)`);
        break;
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
