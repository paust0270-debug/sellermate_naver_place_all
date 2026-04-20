import { connect } from "puppeteer-real-browser";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

type Task = { linkUrl: string; searchKeyword: string; rankOnly: boolean };

function parseArg(name: string): string {
  const hit = process.argv.find((a) => a.startsWith(name + "="));
  return hit ? hit.slice(name.length + 1) : "";
}

async function run() {
  const sourceRoot = process.env.PLACE_SOURCE_ROOT || "";
  const tasksFile = parseArg("--tasksFile");
  if (!sourceRoot) throw new Error("PLACE_SOURCE_ROOT 누락");
  if (!tasksFile || !fs.existsSync(tasksFile)) throw new Error("tasks 파일 없음: " + tasksFile);

  const corePath = path.join(sourceRoot, "place-check", "check-place-rank-core.ts");
  const core = await import(pathToFileURL(corePath).href);
  const checkPlaceRankRankOnly = core.checkPlaceRankRankOnly;
  const checkPlaceRank = core.checkPlaceRank;
  const resetPlaceGuiDelaysCache = core.resetPlaceGuiDelaysCache;
  const delayFromGuiConfig = core.delayFromGuiConfig;
  if (typeof checkPlaceRankRankOnly !== "function") {
    throw new Error("checkPlaceRankRankOnly 함수 로드 실패");
  }
  if (typeof checkPlaceRank !== "function") {
    throw new Error("checkPlaceRank 함수 로드 실패");
  }
  if (typeof resetPlaceGuiDelaysCache === "function") resetPlaceGuiDelaysCache();

  const tasks = JSON.parse(fs.readFileSync(tasksFile, "utf-8")) as Task[];
  const { page, browser } = await connect({ headless: false, turnstile: true });
  try {
    await page.setViewport({ width: 1280, height: 900 });
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const kw = t.searchKeyword;
      const modeLabel = t.rankOnly ? "순위만" : "상세포함";
      console.log("[ROW] 시작 " + (i + 1) + "/" + tasks.length + " | " + modeLabel + " | " + kw);
      const result = t.rankOnly
        ? await checkPlaceRankRankOnly(page, t.linkUrl, kw)
        : await checkPlaceRank(page, t.linkUrl, kw);
      const rank = result?.rank ?? null;
      const placeName = result?.placeName ?? null;
      const visitorReviewCount = result?.visitorReviewCount ?? null;
      const blogReviewCount = result?.blogReviewCount ?? null;
      const starRating = result?.starRating ?? null;
      console.log("[ROW_RESULT] " + JSON.stringify({ index: i, searchKeyword: kw, linkUrl: t.linkUrl, rankOnly: t.rankOnly, rank, placeName, visitorReviewCount, blogReviewCount, starRating }));
      if (i < tasks.length - 1 && typeof delayFromGuiConfig === "function") {
        await delayFromGuiConfig("taskGapRest", 2000, 3000);
      }
    }
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("[ROW_ERROR] " + (e?.message || String(e)));
  process.exit(1);
});
