import "dotenv/config";
import { getDb } from "./server/db";
import { experimentProducts, experimentRankHistory } from "./drizzle/schema";
import { createNaverBot } from "./server/services/naverBot";
import { eq } from "drizzle-orm";

/**
 * 언제든지 실행 가능한 순위 체크 스크립트
 *
 * Usage:
 *   npx tsx check-ranks-anytime.ts [experimentRunId] [checkDay]
 *
 * Examples:
 *   npx tsx check-ranks-anytime.ts 1 0  # 트래픽 작업 전 초기 순위
 *   npx tsx check-ranks-anytime.ts 1 1  # D+1일 중간 체크
 *   npx tsx check-ranks-anytime.ts 1 2  # D+2일 중간 체크
 *   npx tsx check-ranks-anytime.ts 1 3  # D+3일 최종 체크
 */

async function main() {
  // 커맨드라인 인자 파싱
  const experimentRunId = parseInt(process.argv[2] || "1");
  const checkDay = parseInt(process.argv[3] || "0");

  const dayLabels: Record<number, string> = {
    0: "초기 순위 (트래픽 작업 전)",
    1: "D+1일 중간 체크",
    2: "D+2일 중간 체크",
    3: "D+3일 최종 체크",
  };

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 순위 체크 스크립트");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Experiment Run ID: ${experimentRunId}`);
  console.log(`Check Day: ${checkDay} (${dayLabels[checkDay] || "알 수 없음"})`);
  console.log("");

  // DB 연결
  const db = await getDb();
  if (!db) {
    throw new Error("Database connection not available");
  }

  // 실험 상품 가져오기
  const products = await db.select().from(experimentProducts);

  if (products.length === 0) {
    console.log("❌ 실험 상품이 없습니다.");
    process.exit(1);
  }

  console.log(`✅ 상품 ${products.length}개 로드 완료`);
  console.log("");

  // Puppeteer 봇 생성 (HTTP 모드)
  const bot = await createNaverBot(false);
  bot.setMode("minimal-http");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔍 순위 체크 시작");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  const results: Array<{
    productId: string;
    productName: string;
    initialRank: number;
    currentRank: number;
    change: number;
  }> = [];

  let processed = 0;
  let notFound = 0;
  let errors = 0;

  // Mock task (순위 체크용)
  const mockTask: any = {
    uaChange: 1,
    cookieHomeMode: 1,
    shopHome: 1,
    useNid: 0,
    useImage: 1,
    workType: 1, // 검색만 (트래픽 없음)
    randomClickCount: 2,
    workMore: 1,
    secFetchSiteMode: 1,
    lowDelay: 2,
  };

  const mockKeywordData = {
    user_agent: "Mozilla/5.0 (Linux; Android 8.0.0; SM-G930K Build/R16NW; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/92.0.4515.131 Mobile Safari/537.36",
    nnb: "",
    nid_aut: "",
    nid_ses: "",
  };

  // Mock campaign 생성 함수
  const createMockCampaign = (product: typeof products[0]) => ({
    keyword: product.keyword!,
    productId: product.productId!,
  });

  // 각 상품의 순위 체크
  for (const product of products) {
    processed++;
    const progress = `[${processed}/${products.length}]`;

    console.log(`${progress} ${product.productName?.substring(0, 40)}...`);

    try {
      const mockCampaign = createMockCampaign(product);
      const currentRank = await bot.checkRank(mockTask, mockCampaign as any, mockKeywordData as any);

      const initialRank = product.position || 0;
      const change = initialRank > 0 && currentRank > 0 ? initialRank - currentRank : 0;

      if (currentRank > 0) {
        console.log(`   ✅ 현재 순위: ${currentRank}위 (초기: ${initialRank}위, 변동: ${change > 0 ? '+' : ''}${change})`);
      } else {
        console.log(`   ❌ 순위권 밖 (400위 이하 또는 미발견)`);
        notFound++;
      }

      // DB에 저장
      await db.insert(experimentRankHistory).values({
        experimentRunId,
        productId: product.productId!,
        rank: currentRank,
        checkDay,
        notes: dayLabels[checkDay] || `Day ${checkDay} 체크`,
      });

      results.push({
        productId: product.productId!,
        productName: product.productName!,
        initialRank,
        currentRank,
        change,
      });

      // 딜레이 (Rate limiting 방지)
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error: any) {
      console.log(`   ⚠️  에러: ${error.message}`);
      errors++;

      // 에러도 기록 (-1로 저장)
      await db.insert(experimentRankHistory).values({
        experimentRunId,
        productId: product.productId!,
        rank: -1,
        checkDay,
        notes: `에러: ${error.message}`,
      });
    }

    console.log("");
  }

  await bot.close();

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📈 순위 체크 완료");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log(`총 상품: ${products.length}개`);
  console.log(`순위 발견: ${products.length - notFound - errors}개`);
  console.log(`순위권 밖: ${notFound}개`);
  console.log(`에러: ${errors}개`);
  console.log("");

  // 순위 변동 통계
  if (checkDay > 0) {
    const ranked = results.filter(r => r.currentRank > 0 && r.initialRank > 0);
    const improved = ranked.filter(r => r.change > 0);
    const declined = ranked.filter(r => r.change < 0);
    const unchanged = ranked.filter(r => r.change === 0);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 순위 변동 통계");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    console.log(`순위 상승: ${improved.length}개 (${((improved.length / ranked.length) * 100).toFixed(1)}%)`);
    console.log(`순위 하락: ${declined.length}개 (${((declined.length / ranked.length) * 100).toFixed(1)}%)`);
    console.log(`순위 유지: ${unchanged.length}개 (${((unchanged.length / ranked.length) * 100).toFixed(1)}%)`);
    console.log("");

    if (improved.length > 0) {
      const avgImprovement = improved.reduce((sum, r) => sum + r.change, 0) / improved.length;
      const maxImprovement = Math.max(...improved.map(r => r.change));
      console.log(`평균 상승폭: ${avgImprovement.toFixed(1)}위`);
      console.log(`최대 상승폭: ${maxImprovement}위`);
      console.log("");

      console.log("🏆 상위 5개 순위 상승 상품:");
      improved
        .sort((a, b) => b.change - a.change)
        .slice(0, 5)
        .forEach((r, i) => {
          console.log(`${i + 1}. [+${r.change}위] ${r.productName.substring(0, 40)}`);
          console.log(`   ${r.initialRank}위 → ${r.currentRank}위`);
        });
    }
  }

  console.log("");
  console.log("✅ 순위 데이터가 experimentRankHistory 테이블에 저장되었습니다.");
  console.log("");

  process.exit(0);
}

main();
