#!/usr/bin/env npx tsx
import "dotenv/config";
import { connect } from "puppeteer-real-browser";
import { findAccurateRank } from "../accurate-rank-checker";

const keyword = process.argv[2];
const targetMid = process.argv[3];

if (!keyword || !targetMid) {
  console.log("사용법: npx tsx rank-check/single/check-mid-rank-accurate.ts <키워드> <MID>");
  process.exit(1);
}

async function main() {
  console.log(`🔎 키워드: ${keyword}`);
  console.log(`🎯 MID: ${targetMid}\n`);

  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  try {
    const result = await findAccurateRank(page as any, keyword, targetMid);

    if (!result) {
      console.log("❌ 15페이지(600위) 이내에서 상품을 찾지 못했습니다.");
      return;
    }

    console.log("\n✅ 순위 측정 결과");
    console.log(`• 전체 순위 (광고 포함): ${result.totalRank}위`);
    console.log(
      `• 오가닉 순위 (광고 제외): ${
        result.organicRank > 0 ? `${result.organicRank}위` : "광고 상품 - 별도 집계 불가"
      }`
    );
    console.log(`• 광고 여부: ${result.isAd ? "광고" : "일반"}`);
    console.log(`• 위치: ${result.page}페이지 / ${result.pagePosition}번째`);
    console.log(`• 상품명: ${result.productName}`);
  } catch (error: any) {
    console.error("🚨 순위 체크 실패:", error.message || error);
  } finally {
    await browser.close();
  }
}

main();
