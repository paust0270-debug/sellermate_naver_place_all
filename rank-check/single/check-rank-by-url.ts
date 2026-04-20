#!/usr/bin/env npx tsx
/**
 * URL 기반 순위 체크 CLI
 *
 * 사용법:
 *   npx tsx rank-check/single/check-rank-by-url.ts <URL> <키워드> [maxPages]
 *
 * 예시:
 *   npx tsx rank-check/single/check-rank-by-url.ts \
 *     "https://smartstore.naver.com/sgata/products/5671646899?NaPm=..." \
 *     "장난감" \
 *     15
 */

import "dotenv/config";
import { connect } from "puppeteer-real-browser";
import { findAccurateRank } from "../accurate-rank-checker";
import { extractMidFromUrl } from "../utils/extractMidFromUrl";
import { getCatalogMidFromUrl, isSmartStoreUrl } from "../utils/getCatalogMidFromUrl";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("❌ 사용법: npx tsx rank-check/single/check-rank-by-url.ts <URL> <키워드> [maxPages]");
    console.log("\n예시:");
    console.log('  npx tsx rank-check/single/check-rank-by-url.ts \\');
    console.log('    "https://smartstore.naver.com/sgata/products/5671646899?NaPm=..." \\');
    console.log('    "장난감" \\');
    console.log('    15');
    process.exit(1);
  }

  const productUrl = args[0];
  const keyword = args[1];
  const maxPages = args[2] ? parseInt(args[2], 10) : 15;

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("URL 기반 순위 체크");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`URL: ${productUrl}`);
  console.log(`키워드: ${keyword}`);
  console.log(`최대 페이지: ${maxPages}`);
  console.log();

  // 1. 브라우저 실행 (스마트스토어 URL은 브라우저가 필요)
  console.log("1️⃣ 브라우저 실행 중...");
  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  try {
    // 2. URL에서 MID 추출
    console.log("\n2️⃣ URL에서 MID 추출 중...");
    let mid = extractMidFromUrl(productUrl);

    // 스마트스토어 URL인 경우, 상품 페이지에서 실제 Catalog MID 추출
    if (isSmartStoreUrl(productUrl)) {
      console.log(`   스마트스토어 URL 감지 → 상품 페이지 방문하여 Catalog MID 추출`);
      const catalogMidResult = await getCatalogMidFromUrl(page as any, productUrl);

      if (catalogMidResult.mid) {
        console.log(`   ✅ Channel Product No: ${mid}`);
        console.log(`   ✅ Catalog MID (검색용): ${catalogMidResult.mid}`);
        mid = catalogMidResult.mid;
      } else {
        console.log(`   ⚠️ Catalog MID 추출 실패, Channel Product No 사용: ${mid}`);
      }
    } else {
      if (!mid) {
        console.log("❌ URL에서 MID를 추출할 수 없습니다.");
        console.log("\n지원하는 URL 형식:");
        console.log("  • https://smartstore.naver.com/{storeId}/products/{MID}");
        console.log("  • https://cr3.shopping.naver.com/v2/bridge?nvMid={MID}");
        console.log("  • https://search.shopping.naver.com/catalog/{MID}");
        await browser.close();
        process.exit(1);
      }
      console.log(`✅ MID: ${mid}`);
    }

    // 3. 순위 체크
    console.log("\n3️⃣ 순위 체크 시작\n");
    const result = await findAccurateRank(page as any, keyword, mid, maxPages);

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("결과");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (result) {
      console.log(`✅ 순위 발견!`);
      console.log(`\n상품 정보:`);
      console.log(`  • 상품명: ${result.productName}`);
      console.log(`  • MID: ${result.mid}`);
      console.log(`\n순위 정보:`);
      console.log(`  • 전체 순위: ${result.totalRank}위`);
      console.log(`  • 오가닉 순위: ${result.organicRank}위`);
      console.log(`  • 광고 여부: ${result.isAd ? "광고" : "오가닉"}`);
      console.log(`\n위치 정보:`);
      console.log(`  • 페이지: ${result.page}페이지`);
      console.log(`  • 페이지 내 위치: ${result.pagePosition}번째`);
    } else {
      console.log(`❌ ${maxPages}페이지 내에서 순위를 찾지 못했습니다.`);
      console.log(`\n가능한 원인:`);
      console.log(`  • 상품이 ${maxPages * 40}위 밖에 있음`);
      console.log(`  • 키워드가 정확하지 않음`);
      console.log(`  • 봇 탐지로 차단됨`);
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    await browser.close();
  } catch (error: any) {
    console.error("\n🚨 에러 발생:", error.message);
    await browser.close();
    process.exit(1);
  }
}

main();
