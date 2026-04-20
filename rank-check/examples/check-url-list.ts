#!/usr/bin/env npx tsx
/**
 * URL 리스트 일괄 순위 체크 예시
 *
 * 사용법:
 *   npx tsx rank-check/examples/check-url-list.ts
 */

import "dotenv/config";
import { connect } from "puppeteer-real-browser";
import { findAccurateRank } from "../accurate-rank-checker";
import { extractMidFromUrl } from "../utils/extractMidFromUrl";

interface UrlCheckTask {
  url: string;
  keyword: string;
  productName?: string;
}

const urlList: UrlCheckTask[] = [
  {
    url: "https://smartstore.naver.com/sgata/products/5671646899?NaPm=ct%3Dmifb9p3c...",
    keyword: "장난감",
    productName: "예시 상품 1",
  },
  {
    url: "https://smartstore.naver.com/store123/products/1234567890",
    keyword: "인형",
    productName: "예시 상품 2",
  },
  // 여기에 URL 추가...
];

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📋 URL 리스트 일괄 순위 체크`);
  console.log(`총 ${urlList.length}개 상품`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  const results = [];

  try {
    for (let i = 0; i < urlList.length; i++) {
      const task = urlList[i];

      console.log(`\n[${i + 1}/${urlList.length}] ${task.productName || task.url}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      // 1. MID 추출
      const mid = extractMidFromUrl(task.url);
      if (!mid) {
        console.log(`❌ URL에서 MID 추출 실패`);
        results.push({
          ...task,
          mid: null,
          rank: null,
          error: "MID 추출 실패",
        });
        continue;
      }

      console.log(`✅ MID: ${mid}`);

      // 2. 순위 체크
      const result = await findAccurateRank(page as any, task.keyword, mid, 15);

      if (result) {
        console.log(`✅ 순위 발견!`);
        console.log(`   • 전체 순위: ${result.totalRank}위`);
        console.log(`   • 오가닉 순위: ${result.organicRank}위`);
        console.log(`   • 페이지: ${result.page}페이지`);
        console.log(`   • 광고: ${result.isAd ? "YES" : "NO"}`);

        results.push({
          ...task,
          mid,
          totalRank: result.totalRank,
          organicRank: result.organicRank,
          page: result.page,
          isAd: result.isAd,
          found: true,
        });
      } else {
        console.log(`❌ 15페이지(600위) 내 순위 없음`);
        results.push({
          ...task,
          mid,
          rank: null,
          error: "600위 밖",
        });
      }

      // 다음 검색 전 대기 (봇 탐지 방지)
      if (i < urlList.length - 1) {
        console.log(`\n⏳ 다음 검색 대기 (5초)...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
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
          `  • ${r.productName || r.url.substring(0, 50)} - ${r.totalRank}위 (${r.isAd ? "광고" : "오가닉"})`
        );
      });
    }

    if (notFound.length > 0) {
      console.log("\n순위 없는 상품:");
      notFound.forEach((r: any) => {
        console.log(`  • ${r.productName || r.url.substring(0, 50)} - ${r.error}`);
      });
    }

    // JSON 파일로 저장
    const fs = require("fs");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `rank-check-results-${timestamp}.json`;

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
