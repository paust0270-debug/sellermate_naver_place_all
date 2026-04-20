import "dotenv/config";

/**
 * 현재 순위 확인 - 장난감 키워드에서 특정 상품 순위
 */

const KEYWORD = "장난감";
const TARGET_STORE = "gamenarajsoft"; // 토이랑북이랑
const TARGET_PRODUCT_ID = "10373753920";

async function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function checkRank() {
  console.log("====================================");
  console.log(`[순위 확인] ${KEYWORD}`);
  console.log(`타겟: ${TARGET_STORE} / ${TARGET_PRODUCT_ID}`);
  console.log("====================================\n");

  const { connect } = await import("puppeteer-real-browser");

  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  try {
    // Step 1: Naver Main
    await page.goto("https://m.naver.com", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await delay(1000);

    // Step 2: Search
    await page.evaluate((kw: string) => {
      const input = document.querySelector('input[type="search"], input[name="query"]') as HTMLInputElement;
      if (input) {
        input.value = kw;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const form = input.closest('form');
        if (form) form.submit();
      }
    }, KEYWORD);

    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    await delay(2000);

    // Step 3: 스마트스토어 링크들 수집 (순위 확인)
    let foundRank = -1;
    let totalChecked = 0;

    // 스크롤하면서 스마트스토어 링크 찾기
    for (let scroll = 0; scroll < 10; scroll++) {
      const result = await page.evaluate((targetStore: string, targetProductId: string) => {
        const links = document.querySelectorAll('a');
        const stores: { href: string; rank: number }[] = [];
        let rank = 0;

        for (const link of links) {
          const href = link.href || '';
          if (href.includes('smartstore.naver.com') && !href.includes('search')) {
            rank++;
            stores.push({ href, rank });

            if (href.includes(targetStore) || href.includes(targetProductId)) {
              return { found: true, rank, href, totalChecked: rank };
            }
          }
        }

        return { found: false, stores, totalChecked: rank };
      }, TARGET_STORE, TARGET_PRODUCT_ID);

      if (result.found) {
        foundRank = result.rank;
        console.log(`\n✓ 상품 발견! 순위: ${foundRank}`);
        console.log(`  URL: ${result.href}`);
        break;
      }

      totalChecked = result.totalChecked;
      console.log(`스크롤 ${scroll + 1}: ${totalChecked}개 스마트스토어 확인됨...`);

      // 더 스크롤
      await page.evaluate(() => window.scrollBy(0, 800));
      await delay(1500);
    }

    if (foundRank === -1) {
      console.log(`\n✗ 상품을 찾지 못함 (${totalChecked}개 확인)`);
      console.log("  → 100위 밖이거나 검색 결과에 없음");
    }

    // 결과 저장
    const fs = await import("fs");
    const result = {
      keyword: KEYWORD,
      targetStore: TARGET_STORE,
      targetProductId: TARGET_PRODUCT_ID,
      productName: "티아츠 토미카 01 닛산 GT-R (BNR 34) 경찰차",
      initialRank: foundRank,
      checkedAt: new Date().toISOString(),
      trafficDate: "2025-11-21T19:28:48.507Z",
      trafficVisits: 100,
      note: "3일 후 (2025-11-24) 순위 재확인 필요"
    };

    fs.writeFileSync("docs/rank_baseline.json", JSON.stringify(result, null, 2));
    console.log("\n결과 저장: docs/rank_baseline.json");
    console.log(JSON.stringify(result, null, 2));

    await delay(3000);
    await browser.close();

    return result;

  } catch (error: any) {
    console.log(`[ERROR] ${error.message}`);
    await browser.close();
    throw error;
  }
}

checkRank().catch(console.error);
