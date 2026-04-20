/**
 * Unified Runner - Patchright 엔진 + 독립 워커 (sellermate 테이블)
 * sellermate_naver_place_all 내장용: 이 폴더만으로 실행 가능
 *
 * 실행: npx tsx unified-runner.ts
 *
 * 워크플로우:
 * 1. 현재 IP 확인 (Heartbeat/로그용)
 * 2. N개 워커 독립 실행 (각 워커가 무한 루프)
 * 3. sellermate_traffic_navershopping id 내림차순으로 작업 가져오기
 * 4. 성공 시 success_count +1, 실패 시 fail_count +1 (sellermate_slot_naver)
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Chrome/Puppeteer Temp 폴더 설정
// D 드라이브 있으면 D:\temp, 없으면 C:\turafic\temp 사용
const getDriveLetter = () => {
  try {
    if (fs.existsSync('D:\\')) {
      return 'D:\\temp';
    }
  } catch (e) {}
  // D 드라이브 없으면 C:\turafic\temp 사용
  return 'C:\\turafic\\temp';
};

const TEMP_DIR = getDriveLetter();
try {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  process.env.TEMP = TEMP_DIR;
  process.env.TMP = TEMP_DIR;
  process.env.TMPDIR = TEMP_DIR;
  console.log(`[TEMP] Using: ${TEMP_DIR}`);
} catch (e: any) {
  console.error(`[TEMP] Failed to create temp dir: ${e.message}`);
  console.error(`[TEMP] Using system default temp dir`);
}

// .env 로드 (place_all 루트 우선)
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), '.env.local'),
  path.join(__dirname, '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '.env.local'),
];
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log(`[ENV] Loaded from: ${envPath}`);
    break;
  }
}

import { chromium, type Page, type Browser, type BrowserContext } from "patchright";
import { createClient } from "@supabase/supabase-js";
import { getCurrentIP } from "../ipRotation.js";
import { ReceiptCaptchaSolverPRB } from "./captcha/ReceiptCaptchaSolverPRB";
import { applyMobileStealth, MOBILE_CONTEXT_OPTIONS } from "./shared/mobile-stealth";

// ================================================================
//  탐지 우회 계층 구조 (Detection Bypass Layers)
// ================================================================
//
//  ┌─────────────────────────────────────────────────────────────┐
//  │  1. 네트워크 계층 (Network Layer)                           │
//  │     - 외부 IP 확인 (Heartbeat/로그용)                        │
//  ├─────────────────────────────────────────────────────────────┤
//  │  2. 브라우저 계층 (Browser Layer)                           │
//  │     - Patchright (Playwright fork, 봇 탐지 우회)            │
//  │     - 브라우저 창 위치/크기, 멀티 인스턴스                   │
//  ├─────────────────────────────────────────────────────────────┤
//  │  3. 디바이스 계층 (Device Layer)                            │
//  │     - UserAgent, Viewport, 핑거프린트                       │
//  │     - channel: 'chrome' 으로 시스템 Chrome 사용             │
//  ├─────────────────────────────────────────────────────────────┤
//  │  4. 세션/쿠키 계층 (Session/Cookie Layer)                   │
//  │     - 프로필 관리 (profiles/*.json)                         │
//  │     - 매번 새 context로 깨끗한 세션                         │
//  ├─────────────────────────────────────────────────────────────┤
//  │  5. 행동 계층 (Behavior Layer)                              │
//  │     - 베지어 곡선 마우스 (cubicBezier, bezierMouseMove)     │
//  │     - 인간화 타이핑 (humanizedType)                         │
//  │     - 자연스러운 스크롤 (humanScroll)                       │
//  │     - 랜덤 체류 시간                                         │
//  └─────────────────────────────────────────────────────────────┘
//
// ================================================================

// ============ 설정 ============
const PARALLEL_BROWSERS = Math.max(1, parseInt(process.env.PARALLEL_BROWSERS || "2", 10));  // 동시 실행 워커 수 (환경변수로 오버라이드, 기본 2)
const ONCE_MODE = process.argv.includes("--once");  // 통합 러너에서 1건만 처리 후 종료
const WORKER_REST = 2 * 1000;   // 워커 작업 간 휴식 (2초)
const EMPTY_WAIT = 10 * 1000;   // 작업 없을 때 대기 (10초)
const WORKER_START_DELAY = 3000;  // 워커 시작 간격 (3초)

// 브라우저 창 위치 (4분할 배치 - 모바일 사이트용 좁은 창)
const BROWSER_POSITIONS: { x: number; y: number }[] = [
  { x: 0, y: 0 },      // Worker 1: 좌상단
  { x: 480, y: 0 },    // Worker 2: 우상단
  { x: 0, y: 540 },    // Worker 3: 좌하단
  { x: 480, y: 540 },  // Worker 4: 우하단
];
const BROWSER_WIDTH = 480;   // 브라우저 너비 (모바일 사이트용)
const BROWSER_HEIGHT = 540;  // 브라우저 높이

// 모바일/웹 모드 설정
const USE_MOBILE_MODE = true;  // true: 모바일(m.smartstore), false: 웹(smartstore)

// 모바일 디바이스 설정 (mobile-stealth.ts에서 import)
// MOBILE_CONTEXT_OPTIONS 사용으로 platform-version, model 헤더 포함
const MOBILE_CONTEXT = MOBILE_CONTEXT_OPTIONS;

// 웹(PC) 디바이스 설정
const WEB_CONTEXT = {
  viewport: { width: 400, height: 700 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PRODUCTION_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PRODUCTION_KEY || '';
const EQUIPMENT_NAME = process.env.EQUIPMENT_NAME || '';

// ============ Supabase 클라이언트 ============
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[ENV] SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (또는 SUPABASE_PRODUCTION_*) 설정 필요');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============ 타입 정의 ============
interface WorkItem {
  taskId: number;
  slotSequence: number;
  keyword: string;
  productName: string;
  mid: string;
  linkUrl: string;
  /** 2차 검색어 조합·링크 매칭용: keyword_name */
  keywordName?: string;
}

interface Profile {
  name: string;
  prb_options?: {
    headless?: boolean;
    turnstile?: boolean;
  };
}

interface RunContext {
  log: (event: string, data?: any) => void;
  profile: Profile;
  login: boolean;
}


// ============ 전역 통계 ============
let totalRuns = 0;
let totalSuccess = 0;
let totalCaptcha = 0;
let totalFailed = 0;
let sessionStartTime = Date.now();
let currentIP = "";

// ============ 작업 큐 락 (동시 접근 방지) ============
let isClaimingTask = false;

// ============ traffic 조회 순서: 1번 내림차순 → 2번 오름차순 → 반복 ============
let trafficOrderAscending = false;

// ============ Git 업데이트 체크 ============
const GIT_CHECK_INTERVAL = 3 * 60 * 1000; // 3분마다 체크
let lastCommitHash = "";

function getCurrentCommitHash(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

function checkForUpdates(): boolean {
  try {
    // fetch만 (pull 안 함)
    execSync("git fetch origin main", { encoding: "utf8", timeout: 30000 });
    const remoteHash = execSync("git rev-parse origin/main", { encoding: "utf8", timeout: 5000 }).trim();
    const localHash = getCurrentCommitHash();

    if (remoteHash && localHash && remoteHash !== localHash) {
      return true; // 업데이트 있음
    }
    return false;
  } catch {
    return false;
  }
}

function startGitUpdateChecker(): void {
  // 현재 커밋 해시 저장
  lastCommitHash = getCurrentCommitHash();

  setInterval(() => {
    if (checkForUpdates()) {
      log("Git update detected! Restarting to apply changes...", "warn");
      // 런처가 재시작해줌
      process.exit(0);
    }
  }, GIT_CHECK_INTERVAL);
}

// ============ 유틸 ============
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg: string, level: "info" | "warn" | "error" = "info") {
  const time = new Date().toISOString().substring(11, 19);
  const prefix = { info: "[INFO]", warn: "[WARN]", error: "[ERROR]" }[level];
  console.log(`[${time}] ${prefix} ${msg}`);
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomKeyDelay(): number {
  return 30 + Math.random() * 30;
}

// ============ [행동 계층] 베지어 곡선 마우스 ============
// 봇 탐지 우회: 직선이 아닌 자연스러운 곡선으로 마우스 이동
interface Point { x: number; y: number; }

function cubicBezier(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
  };
}

function generateBezierPath(start: Point, end: Point, steps: number): Point[] {
  const path: Point[] = [];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const curvature = Math.min(distance * 0.3, 100);

  const cp1: Point = {
    x: start.x + dx * 0.25 + (Math.random() - 0.5) * curvature,
    y: start.y + dy * 0.1 + (Math.random() - 0.5) * curvature
  };
  const cp2: Point = {
    x: start.x + dx * 0.75 + (Math.random() - 0.5) * curvature,
    y: start.y + dy * 0.9 + (Math.random() - 0.5) * curvature
  };

  for (let i = 0; i <= steps; i++) {
    let t = i / steps;
    t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const point = cubicBezier(t, start, cp1, cp2, end);
    point.x += (Math.random() - 0.5) * 2;
    point.y += (Math.random() - 0.5) * 2;
    path.push(point);
  }
  return path;
}

async function bezierMouseMove(page: Page, fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  const distance = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
  const steps = Math.floor(Math.min(40, Math.max(20, distance / 10)));
  const path = generateBezierPath({ x: fromX, y: fromY }, { x: toX, y: toY }, steps);

  for (const point of path) {
    await page.mouse.move(point.x, point.y);
    await sleep(randomBetween(2, 8));
  }
}

// CDP 세션 캐시
const cdpSessions = new Map<Page, any>();

async function getCDPSession(page: Page): Promise<any> {
  if (!cdpSessions.has(page)) {
    const client = await page.context().newCDPSession(page);
    cdpSessions.set(page, client);
  }
  return cdpSessions.get(page)!;
}

// ============ [행동 계층] 인간화 스크롤 (모바일 터치 제스처) ============
// 봇 탐지 우회: CDP synthesizeScrollGesture로 진짜 터치 스크롤 시뮬레이션
async function humanScroll(page: Page, targetY: number): Promise<void> {
  const viewport = page.viewportSize();

  // viewport가 없거나 너무 작으면 폴백: 일반 스크롤
  if (!viewport || viewport.width < 100 || viewport.height < 100) {
    await page.evaluate((y) => window.scrollBy(0, y), targetY).catch(() => {});
    await sleep(500);
    return;
  }

  const client = await getCDPSession(page);
  // x, y는 최소 50 이상 보장 (CDP 파라미터 범위 에러 방지)
  const x = Math.max(50, Math.floor(viewport.width / 2));
  const y = Math.max(50, Math.floor(viewport.height / 2));

  let scrolled = 0;
  while (scrolled < targetY) {
    const step = 100 + Math.random() * 150;

    try {
      // CDP로 모바일 터치 스크롤 제스처 시뮬레이션
      await client.send('Input.synthesizeScrollGesture', {
        x: x,
        y: y,
        yDistance: -Math.floor(step),  // 음수 = 아래로 스크롤
        xDistance: 0,
        speed: Math.min(1200, Math.max(600, Math.floor(randomBetween(800, 1200)))),  // 600~1200 범위 제한
        gestureSourceType: 'touch',
        repeatCount: 1,
        repeatDelayMs: 0,
      });
    } catch (e: any) {
      // CDP 실패 시 폴백: 일반 스크롤
      await page.evaluate((s) => window.scrollBy(0, s), step).catch(() => {});
    }

    scrolled += step;
    await sleep(80 + Math.random() * 60);
  }
}

// ============ [행동 계층] 인간화 타이핑 ============
// 봇 탐지 우회: 랜덤한 키 입력 딜레이 (30~60ms)
async function humanizedType(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector);
  await sleep(randomBetween(250, 600));

  for (const char of text) {
    await page.keyboard.type(char, { delay: randomKeyDelay() });
  }
}

// ============ [행동 계층] 상품명 단어 셔플 ============
// 봇 탐지 우회: 검색 패턴 다변화
function shuffleWords(productName: string): string {
  const cleaned = productName
    .replace(/[\[\](){}]/g, ' ')
    .replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, ' ')
    .trim();
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 1) return cleaned;
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words.join(' ');
}

// ============ Chrome Temp 폴더 정리 (D드라이브) ============
function cleanupChromeTempFolders(): void {
  const tempDirs = ['D:\\temp', 'D:\\tmp'];
  let totalCleaned = 0;

  for (const tempDir of tempDirs) {
    if (!fs.existsSync(tempDir)) continue;

    try {
      const entries = fs.readdirSync(tempDir, { withFileTypes: true });

      for (const entry of entries) {
        // Chrome/Puppeteer 관련 임시 폴더 패턴
        if (entry.isDirectory() && (
          entry.name.startsWith('puppeteer_') ||
          entry.name.startsWith('lighthouse') ||
          entry.name.startsWith('chrome_') ||
          entry.name.startsWith('.org.chromium.') ||
          entry.name.startsWith('scoped_dir')
        )) {
          const folderPath = path.join(tempDir, entry.name);
          try {
            fs.rmSync(folderPath, { recursive: true, force: true });
            totalCleaned++;
          } catch {
            // 사용 중인 폴더는 무시
          }
        }
      }
    } catch {
      // 폴더 접근 실패 무시
    }
  }

  if (totalCleaned > 0) {
    log(`Temp 폴더 정리: ${totalCleaned}개 삭제`);
  }
}

// ============ [세션 계층] 프로필 로드 ============
// 세션 관리: 프로필별 브라우저 설정 로드
function loadProfile(profileName: string): Profile {
  const profilePath = path.join(__dirname, 'profiles', `${profileName}.json`);
  if (fs.existsSync(profilePath)) {
    const content = fs.readFileSync(profilePath, 'utf-8');
    return JSON.parse(content);
  }
  // 기본 프로필
  return {
    name: profileName,
    prb_options: {
      headless: false,
      turnstile: true
    }
  };
}

// ============ link_url에서 상품 MID 추출 (smartstore/brand /products/숫자) ============
function extractMidFromLinkUrl(linkUrl: string | null | undefined): string | null {
  if (!linkUrl || typeof linkUrl !== "string") return null;
  const m = linkUrl.match(/\/products\/(\d+)/);
  return m ? m[1] : null;
}

// ============ 풀제목 → 조합형 키워드 (당일 1번 식별용: 공백 제거) ============
function toCombinedKeyword(fullTitle: string): string {
  return (fullTitle || "").replace(/\s+/g, "").trim() || "상품";
}

// 2차 검색어: keyword + (keyword_name에서 랜덤 1단어) + (판매|최저가|최저|구매|비교|판매처|추천|가격|구매처|가격비교) → 3개 파트 랜덤 순서 띄어쓰기
const SECOND_SEARCH_TAIL_WORDS = ["판매", "최저가", "최저", "구매", "비교", "판매처", "추천", "가격", "구매처", "가격비교"];
function buildSecondSearchPhrase(firstKeyword: string, keywordName: string): string {
  const part1 = (firstKeyword || "").trim() || "상품";
  const nameWords = (keywordName || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const part2 = nameWords.length > 0 ? nameWords[Math.floor(Math.random() * nameWords.length)] : part1;
  const part3 = SECOND_SEARCH_TAIL_WORDS[Math.floor(Math.random() * SECOND_SEARCH_TAIL_WORDS.length)];
  const parts = [part1, part2, part3];
  for (let i = parts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }
  return parts.join(" ");
}

// 2차 검색(조합형) 당일 1번만 작업: 사용한 조합형 키워드 집합, 00시 리셋
let usedCombinedKeywordsToday = new Set<string>();
let lastUsedDate = ""; // YYYY-MM-DD
function resetUsedKeywordsIfNewDay(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (lastUsedDate !== today) {
    usedCombinedKeywordsToday.clear();
    lastUsedDate = today;
  }
}
function isCombinedKeywordUsedToday(combined: string): boolean {
  return usedCombinedKeywordsToday.has(combined);
}
function markCombinedKeywordUsedToday(combined: string): void {
  usedCombinedKeywordsToday.add(combined);
}

// ============ 작업 1개 가져오기 (id 내림차순 + 즉시 삭제) ============
async function claimWorkItem(): Promise<WorkItem | null> {
  while (isClaimingTask) {
    await sleep(100);
  }
  isClaimingTask = true;

  try {
    // 1번: id 내림차순 → 2번: id 오름차순 → 반복
    const ascending = trafficOrderAscending;
    trafficOrderAscending = !trafficOrderAscending;
    const { data: tasks, error: taskError } = await supabase
      .from("sellermate_traffic_navershopping")
      .select("id, slot_sequence, keyword, link_url")
      .order("id", { ascending })
      .limit(10);

    if (taskError) {
      log(`[FETCH ERROR] ${taskError.message}`, "error");
      return null;
    }

    if (!tasks || tasks.length === 0) {
      return null;
    }

    resetUsedKeywordsIfNewDay();

    for (const task of tasks) {
      const { data: slot, error: slotError } = await supabase
        .from("sellermate_slot_naver")
        .select("keyword, link_url, keyword_name")
        .eq("slot_sequence", task.slot_sequence)
        .single();

      if (slotError) {
        log(`[CLAIM] traffic id=${task.id} slot_sequence=${task.slot_sequence} → slot_naver 조회 실패: ${slotError.message}`, "warn");
        await supabase.from("sellermate_traffic_navershopping").delete().eq("id", task.id);
        continue;
      }
      if (!slot) {
        log(`[CLAIM] traffic id=${task.id} slot_sequence=${task.slot_sequence} → slot_naver 행 없음, 삭제`, "warn");
        await supabase.from("sellermate_traffic_navershopping").delete().eq("id", task.id);
        continue;
      }

      const linkUrl = task.link_url || (slot as any).link_url;
      const mid = extractMidFromLinkUrl(linkUrl);
      if (!mid) {
        log(`[CLAIM] traffic id=${task.id} slot_sequence=${task.slot_sequence} → link_url에서 mid 추출 불가: ${linkUrl}`, "warn");
        await supabase.from("sellermate_traffic_navershopping").delete().eq("id", task.id);
        continue;
      }

      const keywordName = ((slot as any).keyword_name ?? (slot as any).keyword ?? "").trim();
      const productName = keywordName || (task.keyword || "").trim() || "상품";
      if (!keywordName) {
        log(`[CLAIM] traffic id=${task.id} slot_sequence=${task.slot_sequence} → keyword_name 없음, 스킵`, "warn");
        continue;
      }

      const combined = toCombinedKeyword(productName);
      if (isCombinedKeywordUsedToday(combined)) {
        log(`[CLAIM] slot_sequence=${task.slot_sequence} 조합형 이미 오늘 사용: "${combined.substring(0, 30)}..." 스킵`, "warn");
        continue;
      }

      const { error: deleteError } = await supabase
        .from("sellermate_traffic_navershopping")
        .delete()
        .eq("id", task.id);

      if (deleteError) {
        log(`[DELETE ERROR] ${deleteError.message}`, "error");
        return null;
      }

      markCombinedKeywordUsedToday(combined);

      return {
        taskId: task.id,
        slotSequence: task.slot_sequence,
        keyword: task.keyword,
        productName,
        mid,
        linkUrl: task.link_url || (slot as any).link_url,
        keywordName: keywordName || undefined
      };
    }

    return null;
  } catch (e: any) {
    log(`[CLAIM ERROR] ${e.message}`, "error");
    return null;
  } finally {
    isClaimingTask = false;
  }
}

// ============ sellermate_slot_naver 통계 업데이트 (success_count / fail_count) ============
// 참고: sellermate_slot_naver에 success_count, fail_count 컬럼이 없으면 업데이트는 스킵됨
async function updateSlotStats(
  slotSequence: number,
  success: boolean,
  failReason?: FailReason
): Promise<void> {
  try {
    if (success) {
      const { data: current, error: selectError } = await supabase
        .from("sellermate_slot_naver")
        .select("success_count")
        .eq("slot_sequence", slotSequence)
        .single();

      if (selectError) {
        if (!selectError.message.includes("column") && !selectError.message.includes("does not exist")) {
          log(`[Stats] Select failed (slot_sequence ${slotSequence}): ${selectError.message}`, "warn");
        }
        return;
      }

      if (current) {
        const newCount = ((current as any).success_count ?? 0) + 1;
        const { error: updateError } = await supabase
          .from("sellermate_slot_naver")
          .update({ success_count: newCount })
          .eq("slot_sequence", slotSequence);

        if (updateError) {
          if (!updateError.message.includes("column") && !updateError.message.includes("does not exist")) {
            log(`[Stats] Update failed (slot_sequence ${slotSequence}): ${updateError.message}`, "warn");
          }
        } else {
          log(`[Stats] slot_sequence ${slotSequence} success_count: ${newCount}`);
        }
      }
    } else {
      const { data: current, error: selectError } = await supabase
        .from("sellermate_slot_naver")
        .select("fail_count")
        .eq("slot_sequence", slotSequence)
        .single();

      if (selectError) {
        if (!selectError.message.includes("column") && !selectError.message.includes("does not exist")) {
          log(`[Stats] Select failed (slot_sequence ${slotSequence}): ${selectError.message}`, "warn");
        }
        return;
      }

      if (current) {
        const newCount = ((current as any).fail_count ?? 0) + 1;
        const { error: updateError } = await supabase
          .from("sellermate_slot_naver")
          .update({ fail_count: newCount })
          .eq("slot_sequence", slotSequence);

        if (updateError) {
          if (!updateError.message.includes("column") && !updateError.message.includes("does not exist")) {
            log(`[Stats] Update failed (slot_sequence ${slotSequence}): ${updateError.message}`, "warn");
          }
        } else {
          log(`[Stats] slot_sequence ${slotSequence} fail_count: ${newCount} (reason: ${failReason || 'unknown'})`);
        }
      }
    }
  } catch (e: any) {
    log(`[Stats] Exception (slot_sequence ${slotSequence}): ${e.message}`, "warn");
  }
}

// ============ [브라우저 계층] Patchright 엔진 실행 ============
// Patchright: Playwright 포크로 봇 탐지 우회 내장
// - navigator.webdriver 속성 제거
// - Chrome DevTools Protocol 탐지 우회
// - 자동화 플래그 숨김

type FailReason =
  | 'NO_MID_MATCH'
  | 'CAPTCHA_UNSOLVED'
  | 'PAGE_NOT_LOADED'
  | 'PRODUCT_DELETED'
  | 'TIMEOUT'
  | 'IP_BLOCKED';

interface EngineResult {
  productPageEntered: boolean;
  captchaDetected: boolean;
  captchaSolved: boolean;
  midMatched: boolean;
  failReason?: FailReason;
  error?: string;
}

async function runPatchrightEngine(
  page: Page,
  mid: string,
  productName: string,
  keyword: string,
  workerId: number,
  keywordName?: string
): Promise<EngineResult> {
  const captchaSolver = new ReceiptCaptchaSolverPRB((msg) => log(`[Worker ${workerId}] ${msg}`));

  const result: EngineResult = {
    productPageEntered: false,
    captchaDetected: false,
    captchaSolved: false,
    midMatched: false
  };

  try {
    // 1차 검색: sellermate_traffic_navershopping.keyword 사용
    const firstKeyword = (keyword || "").trim() || "상품";
    const firstSearchUrl = `https://m.search.naver.com/search.naver?where=m&query=${encodeURIComponent(firstKeyword)}`;
    log(`[Worker ${workerId}] 1차 검색 (traffic.keyword): ${firstKeyword}`);
    await page.goto(firstSearchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(randomBetween(2000, 3000));

    // 2차 검색: keyword + (keyword_name에서 랜덤 1단어) + 꼬리 10개 중 1개 → 3개 파트 랜덤 순서 띄어쓰기
    const nameForSecond = (keywordName || productName || "").trim() || firstKeyword;
    const secondSearchKeyword = buildSecondSearchPhrase(firstKeyword, nameForSecond);
    log(`[Worker ${workerId}] 2차 검색 (3단조합): ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`);
    const searchInput = page.locator('#query, .sch_input, input[name="query"]').first();
    await searchInput.click({ force: true });
    await sleep(randomBetween(300, 500));
    await page.keyboard.press('Control+a');
    await sleep(100);
    await page.keyboard.press('Backspace');
    await sleep(200);
    await searchInput.type(secondSearchKeyword, { delay: randomBetween(80, 150) });
    await sleep(randomBetween(500, 800));
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await sleep(randomBetween(2000, 3000));

    // IP 차단 체크
    const isBlocked = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      return bodyText.includes('비정상적인 접근') ||
             bodyText.includes('자동화된 접근') ||
             bodyText.includes('접근이 제한') ||
             bodyText.includes('잠시 후 다시') ||
             bodyText.includes('비정상적인 요청') ||
             bodyText.includes('이용이 제한');
    }).catch(() => false);

    if (isBlocked) {
      log(`[Worker ${workerId}] IP 차단 감지!`, "warn");
      result.failReason = 'IP_BLOCKED';
      result.error = 'Blocked';
      return result;
    }

    // CAPTCHA 체크
    const searchCaptcha = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      return bodyText.includes('보안 확인') || bodyText.includes('자동입력방지');
    }).catch(() => false);

    if (searchCaptcha) {
      log(`[Worker ${workerId}] 검색 CAPTCHA 감지 - 해결 시도...`);
      result.captchaDetected = true;
      const solved = await captchaSolver.solve(page);
      if (solved) {
        log(`[Worker ${workerId}] 검색 CAPTCHA 해결 성공!`);
        result.captchaSolved = true;
        result.captchaDetected = false;
      } else {
        log(`[Worker ${workerId}] 검색 CAPTCHA 해결 실패`, "warn");
        result.failReason = 'CAPTCHA_UNSOLVED';
        return result;
      }
    }

    // 상품 풀제목(keyword_name)으로 검색 결과에서 해당 상품 링크 찾아 클릭 (MID 무관)
    const nameForMatch = productName.trim().substring(0, 40);
    const MAX_SCROLL = 4;
    let linkClicked = false;

    for (let i = 0; i < MAX_SCROLL && !linkClicked; i++) {
      const found = await page.evaluate((name) => {
        const links = document.querySelectorAll<HTMLAnchorElement>(
          'a[href*="smartstore"], a[href*="brand.naver"], a[href*="shopping.naver"], a[href*="nv_mid="]'
        );
        const sub = name.replace(/\s+/g, ' ').trim().substring(0, 40);
        if (!sub) return false;
        for (const a of links) {
          let el: Element | null = a;
          for (let depth = 0; depth < 6 && el; depth++) {
            const text = (el as HTMLElement).innerText || el.textContent || '';
            if (text && text.includes(sub)) {
              a.setAttribute('data-turafic-click', '1');
              return true;
            }
            el = el.parentElement;
          }
        }
        return false;
      }, nameForMatch);

      if (found) {
        log(`[Worker ${workerId}] 풀제목 매칭 링크 클릭: "${nameForMatch}..."`);
        await page.locator('a[data-turafic-click="1"]').first().evaluate((el: HTMLAnchorElement) => el.removeAttribute('target'));
        await page.locator('a[data-turafic-click="1"]').first().click();
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
        await sleep(2000);
        linkClicked = true;
        result.midMatched = true;

        const dwellTime = randomBetween(3000, 6000);
        log(`[Worker ${workerId}] 체류 ${(dwellTime / 1000).toFixed(1)}초...`);
        await sleep(dwellTime);

        const currentPageUrl = page.url();
        log(`[Worker ${workerId}] 페이지: ${currentPageUrl.substring(0, 60)}...`);
        if (currentPageUrl.includes('smartstore.naver.com') || currentPageUrl.includes('brand.naver.com')) {
          result.productPageEntered = true;
        }
        break;
      }

      await humanScroll(page, 500);
      await sleep(randomBetween(300, 500));
    }

    if (!linkClicked) {
      log(`[Worker ${workerId}] 풀제목 매칭 링크 없음: "${nameForMatch}..."`, "warn");
      result.error = 'NoTitleMatch';
      result.failReason = 'NO_MID_MATCH';
      result.midMatched = false;
      return result;
    }

    return result;

  } catch (e: any) {
    if (e.message?.includes('Timeout') || e.message?.includes('timeout') || e.name === 'TimeoutError') {
      result.error = 'Timeout';
      result.failReason = 'TIMEOUT';
    } else {
      result.error = e.message || 'Unknown';
    }
    return result;
  }
}

// ============ [독립 워커] 무한 루프로 작업 처리 ============
// 각 워커가 독립적으로 작업 가져오기 → 실행 → 다음 작업
async function runIndependentWorker(workerId: number, profile: Profile, onceMode = false): Promise<void> {
  log(`[Worker ${workerId}] 시작${onceMode ? " (1건 처리 후 종료)" : ""}`);

  while (true) {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      // 1. 작업 가져오기
      const work = await claimWorkItem();

      if (!work) {
        // 작업 없으면 대기 (once 모드면 대기 없이 종료)
        if (onceMode) {
          log(`[Worker ${workerId}] 작업 없음 - 종료`);
          process.exit(0);
        }
        await sleep(EMPTY_WAIT);
        continue;
      }

      const productShort = work.productName.substring(0, 30);
      log(`[Worker ${workerId}] 작업: ${productShort}... (mid=${work.mid}) [IP: ${currentIP}]`);

      // 2. Patchright 브라우저 시작
      const pos = BROWSER_POSITIONS[(workerId - 1) % BROWSER_POSITIONS.length];
      browser = await chromium.launch({
        headless: false,
        channel: 'chrome',
        args: [
          `--window-position=${pos.x},${pos.y}`,
          `--window-size=${BROWSER_WIDTH},${BROWSER_HEIGHT}`,
          "--disable-blink-features=AutomationControlled",
        ],
      });

      // 모바일/웹 모드에 따라 context 설정
      context = await browser.newContext(USE_MOBILE_MODE ? MOBILE_CONTEXT : WEB_CONTEXT);

      // 모바일 스텔스 스크립트 적용 (봇 탐지 우회)
      if (USE_MOBILE_MODE) {
        await applyMobileStealth(context);
      }

      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      page.setDefaultNavigationTimeout(60000);

      // 3. Patchright 엔진 실행
      const engineResult = await runPatchrightEngine(
        page,
        work.mid,
        work.productName,
        work.keyword,
        workerId,
        work.keywordName
      );

      // 4. 결과 처리
      totalRuns++;

      if (engineResult.productPageEntered) {
        totalSuccess++;
        await updateSlotStats(work.slotSequence, true);

        const successMsg = `[성공] Worker${workerId} | slot_sequence=${work.slotSequence} | ${productShort}...${engineResult.captchaSolved ? " (CAPTCHA해결)" : ""}`;
        log(successMsg);
        console.log(successMsg);
        if (engineResult.captchaSolved) {
          log(`[Worker ${workerId}] SUCCESS(CAPTCHA해결) | ${productShort}...`);
        } else {
          log(`[Worker ${workerId}] SUCCESS | ${productShort}...`);
        }
      } else {
        totalFailed++;
        const failReason = engineResult.failReason === 'CAPTCHA_UNSOLVED' ? 'CAPTCHA'
          : engineResult.failReason === 'IP_BLOCKED' ? 'IP차단'
          : engineResult.failReason === 'NO_MID_MATCH' ? 'MID없음'
          : engineResult.failReason === 'TIMEOUT' ? '타임아웃'
          : (engineResult.error || 'Unknown');
        await updateSlotStats(work.slotSequence, false, engineResult.failReason);

        const failMsg = `[실패] Worker${workerId} | slot_sequence=${work.slotSequence} | 사유=${failReason} | ${productShort}...`;
        log(failMsg, "warn");
        console.log(failMsg);

        if (engineResult.failReason === 'CAPTCHA_UNSOLVED') {
          totalCaptcha++;
          log(`[Worker ${workerId}] FAIL(CAPTCHA) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === 'IP_BLOCKED') {
          log(`[Worker ${workerId}] FAIL(IP차단) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === 'NO_MID_MATCH') {
          log(`[Worker ${workerId}] FAIL(MID없음) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === 'TIMEOUT') {
          log(`[Worker ${workerId}] FAIL(타임아웃) | ${productShort}...`, "warn");
        } else {
          log(`[Worker ${workerId}] FAIL(${engineResult.error || 'Unknown'}) | ${productShort}...`, "warn");
        }
      }

      // 5. 작업 간 휴식
      await sleep(WORKER_REST + Math.random() * 1000);

      if (onceMode) {
        log(`[Worker ${workerId}] 1건 처리 완료 - 종료`);
        process.exit(0);
      }
    } catch (e: any) {
      log(`[Worker ${workerId}] ERROR: ${e.message}`, "error");
      if (onceMode) process.exit(1);
      await sleep(5000);  // 에러 시 5초 대기
    } finally {
      // 브라우저 종료
      if (browser) {
        await sleep(randomBetween(100, 500));
        await browser.close().catch(() => {});
      }
    }

    // 주기적으로 Temp 폴더 정리 (10작업마다)
    if (totalRuns % 10 === 0 && workerId === 1) {
      cleanupChromeTempFolders();
    }
  }
}

// ============ Heartbeat (장비현황 업데이트) ============
async function sendHeartbeat(): Promise<void> {
  if (!EQUIPMENT_NAME) return;

  try {
    const { data, error, count } = await supabase
      .from('equipment_status')
      .update({
        ip_address: currentIP || 'unknown',
        connection_status: 'connected',
        last_heartbeat: new Date().toISOString(),
      })
      .eq('equipment_name', EQUIPMENT_NAME)
      .select();

    if (error) {
      log(`Heartbeat 실패: ${error.message}`, "warn");
    } else if (!data || data.length === 0) {
      log(`Heartbeat: 매칭되는 장비 없음 (equipment_name=${EQUIPMENT_NAME})`, "warn");
    } else {
      log(`Heartbeat OK (${EQUIPMENT_NAME})`);
    }
  } catch (e: any) {
    log(`Heartbeat 에러: ${e.message}`, "error");
  }
}

// ============ 통계 출력 ============
function printStats(): void {
  const elapsed = (Date.now() - sessionStartTime) / 1000 / 60;
  const successRate = totalRuns > 0 ? (totalSuccess / totalRuns * 100).toFixed(1) : '0';
  const captchaRate = totalRuns > 0 ? (totalCaptcha / totalRuns * 100).toFixed(1) : '0';

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  통계 (${elapsed.toFixed(1)}분 경과)`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  총 실행: ${totalRuns}회`);
  console.log(`  성공: ${totalSuccess} (${successRate}%) | CAPTCHA: ${totalCaptcha} (${captchaRate}%)`);
  console.log(`  실패: ${totalFailed} | 현재 IP: ${currentIP}`);
  console.log(`  속도: ${elapsed > 0 ? (totalRuns / elapsed).toFixed(1) : '0'}회/분`);
  console.log(`${"=".repeat(60)}\n`);
}

// ============ 메인 (전체 계층 조율) ============
// 실행 흐름:
// 1. [네트워크] 테더링 어댑터 감지 + IP 확인
// 2. [세션] 프로필 로드
// 3. [워커] 독립 워커 N개 시작 (각자 무한 루프)
//    └─ [브라우저+디바이스] 워커 생성
//       └─ [행동] 검색/클릭/체류
async function main() {
  // Git 커밋 해시 가져오기
  let gitCommit = 'unknown';
  try {
    gitCommit = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      stdio: 'pipe'
    }).trim();
  } catch (e) {
    // git 명령 실패 시 무시
  }

  const onceMode = process.argv.includes("--once");
  const workerCount = onceMode ? 1 : PARALLEL_BROWSERS;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Unified Runner (Patchright + sellermate 테이블)`);
  console.log(`  Script: unified-runner.ts | Commit: ${gitCommit}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  동시 워커: ${workerCount}개${onceMode ? " (--once 1건 후 종료)" : ""}`);
  console.log(`  테이블: sellermate_traffic_navershopping (id 내림차순) / sellermate_slot_naver`);
  console.log(`${"=".repeat(60)}`);

  // Git 업데이트 체커 시작
  startGitUpdateChecker();
  log(`Git update checker started (interval: ${GIT_CHECK_INTERVAL / 1000}s)`);

  // 프로필 로드
  const profile = loadProfile("pc_v7");
  log(`[Profile] ${profile.name}`);

  // 현재 IP 확인 (Heartbeat/로그용)
  try {
    currentIP = await getCurrentIP();
    log(`현재 IP: ${currentIP}`);
  } catch (e: any) {
    log(`IP 확인 실패: ${e.message}`, "error");
    currentIP = "unknown";
  }

  // 통계 출력 인터벌
  setInterval(printStats, 60000);

  // Heartbeat 시작 (30초마다)
  if (EQUIPMENT_NAME) {
    setInterval(sendHeartbeat, 30000);
    sendHeartbeat(); // 즉시 한 번 전송
    log(`장비명: ${EQUIPMENT_NAME}`);
  }

  // 독립 워커들 시작 (--once면 1개만, 그 외 PARALLEL_BROWSERS개)
  const numWorkers = onceMode ? 1 : PARALLEL_BROWSERS;
  log(`\n${numWorkers}개 워커 시작...`);
  for (let i = 1; i <= numWorkers; i++) {
    runIndependentWorker(i, profile, onceMode).catch((e) => {
      log(`[Worker ${i}] 치명적 에러: ${e.message}`, "error");
      if (onceMode) process.exit(1);
    });

    if (i < numWorkers) {
      await sleep(WORKER_START_DELAY);
    }
  }

  if (onceMode) {
    // --once: 워커가 1건 처리 후 process.exit 하므로 여기 도달하지 않음 (작업 없을 때만)
    log(`[--once] 워커 대기 중...`);
    await new Promise(() => {});  // 워커가 exit할 때까지 대기 (무한 대기)
  }

  log(`모든 워커 시작 완료 - 독립 실행 중...\n`);

  while (true) {
    await sleep(60000);
  }
}

// 종료 시그널
process.on('SIGINT', () => {
  console.log('\n\n[STOP] 종료 요청됨');
  printStats();
  process.exit(0);
});

// 전역 에러 핸들러 (비정상 종료 방지)
process.on('uncaughtException', (error) => {
  const msg = error.message || "";
  // EPERM/ENOENT 에러는 무시 (chrome-launcher Temp 폴더 삭제 시 발생)
  if ((msg.includes('EPERM') || msg.includes('ENOENT')) &&
      (msg.includes('temp') || msg.includes('lighthouse') || msg.includes('puppeteer'))) {
    return;
  }
  console.error(`\n[FATAL] Uncaught Exception: ${error.message}`);
  console.error(error.stack);
  // 죽지 않고 계속 실행
});

process.on('unhandledRejection', (reason: any) => {
  console.error(`\n[FATAL] Unhandled Rejection: ${reason?.message || reason}`);
  // 죽지 않고 계속 실행
});

// 실행
main().catch((error) => {
  console.error(`[FATAL] Main error: ${error.message}`);
  process.exit(1);
});
