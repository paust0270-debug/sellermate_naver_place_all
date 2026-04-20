#!/usr/bin/env npx tsx
/**
 * Supabase에서 URL을 가져와 일괄 순위 체크
 *
 * 사용법:
 *   npx tsx rank-check/examples/check-supabase-urls.ts
 */

import "dotenv/config";
import { connect } from "puppeteer-real-browser";
import { findAccurateRank } from "../accurate-rank-checker";
import { extractMidFromUrl } from "../utils/extractMidFromUrl";
import { db } from "../../drizzle/db";
import { abTestProducts } from "../../drizzle/schema";
import { eq, isNotNull } from "drizzle-orm";

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📋 Supabase URL 기반 순위 체크");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 1. Supabase에서 URL이 있는 상품 가져오기
  console.log("1️⃣ Supabase에서 상품 조회 중...\n");

  const products = await db
    .select({
      id: abTestProducts.id,
      productName: abTestProducts.productName,
      keyword: abTestProducts.keyword,
      productUrl: abTestProducts.productUrl,
      mid: abTestProducts.mid,
    })
    .from(abTestProducts)
    .where(isNotNull(abTestProducts.productUrl))
    .limit(10); // 테스트용으로 10개만

  console.log(`✅ ${products.length}개 상품 조회 완료\n`);

  if (products.length === 0) {
    console.log("❌ URL이 있는 상품이 없습니다.");
    return;
  }

  // 2. 브라우저 실행
  console.log("2️⃣ 브라우저 실행 중...\n");
  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  const results = [];

  try {
    for (let i = 0; i < products.length; i++) {
      const product = products[i];

      console.log(`\n[${i + 1}/${products.length}] ${product.productName}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`키워드: ${product.keyword}`);

      // URL에서 MID 추출 (DB에 MID가 없는 경우 대비)
      let mid = product.mid;
      if (!mid && product.productUrl) {
        mid = extractMidFromUrl(product.productUrl);
        console.log(`✅ URL에서 MID 추출: ${mid}`);
      }

      if (!mid) {
        console.log(`❌ MID 없음`);
        results.push({
          id: product.id,
          productName: product.productName,
          keyword: product.keyword,
          mid: null,
          rank: null,
          error: "MID 없음",
        });
        continue;
      }

      // 순위 체크
      const result = await findAccurateRank(
        page as any,
        product.keyword,
        mid,
        15
      );

      if (result) {
        console.log(`✅ 순위 발견!`);
        console.log(`   • 전체 순위: ${result.totalRank}위`);
        console.log(`   • 오가닉 순위: ${result.organicRank}위`);
        console.log(`   • 페이지: ${result.page}페이지`);
        console.log(`   • 광고: ${result.isAd ? "YES" : "NO"}`);

        results.push({
          id: product.id,
          productName: product.productName,
          keyword: product.keyword,
          mid,
          totalRank: result.totalRank,
          organicRank: result.organicRank,
          page: result.page,
          isAd: result.isAd,
          found: true,
        });

        // Supabase 업데이트 (선택사항)
        // await db.update(abTestProducts)
        //   .set({
        //     currentRank: result.totalRank,
        //     lastChecked: new Date(),
        //   })
        //   .where(eq(abTestProducts.id, product.id));
      } else {
        console.log(`❌ 15페이지(600위) 내 순위 없음`);
        results.push({
          id: product.id,
          productName: product.productName,
          keyword: product.keyword,
          mid,
          rank: null,
          error: "600위 밖",
        });
      }

      // 다음 검색 전 대기
      if (i < products.length - 1) {
        console.log(`\n⏳ 다음 검색 대기 (5초)...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    // 최종 결과 요약
    console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 전체 결과 요약");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const found = results.filter((r) => r.found);
    const notFound = results.filter((r) => !r.found);

    console.log(`총 ${results.length}개 상품`);
    console.log(`✅ 순위 발견: ${found.length}개`);
    console.log(`❌ 순위 없음: ${notFound.length}개\n`);

    if (found.length > 0) {
      console.log("발견된 상품:");
      found.forEach((r: any) => {
        console.log(
          `  • ${r.productName.substring(0, 30)} - ${r.totalRank}위 (${r.isAd ? "광고" : "오가닉"})`
        );
      });
    }

    if (notFound.length > 0) {
      console.log("\n순위 없는 상품:");
      notFound.forEach((r: any) => {
        console.log(`  • ${r.productName.substring(0, 30)} - ${r.error}`);
      });
    }

    // JSON 파일로 저장
    const fs = require("fs");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `supabase-rank-check-${timestamp}.json`;

    fs.writeFileSync(filename, JSON.stringify(results, null, 2), "utf-8");
    console.log(`\n💾 결과 저장: ${filename}`);

    await browser.close();
  } catch (error: any) {
    console.error("\n🚨 에러 발생:", error.message);
    await browser.close();
    process.exit(1);
  }
}

main();
