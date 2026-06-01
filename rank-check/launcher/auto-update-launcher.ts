#!/usr/bin/env npx tsx
/**
 * 자동 업데이트 런처 (쇼핑 순위체크 전용, 작업 감시 모드)
 *
 * - 5분마다 Git 업데이트 확인 및 pull
 * - 작업 큐 감시 → check-batch-worker-pool 실행
 *
 * 통합(쇼핑+쿠팡+플레이스) 원격 실행은 remote-watch-launcher.ts / start-remote.bat 사용
 *
 *   npx tsx rank-check/launcher/auto-update-launcher.ts
 */

import 'dotenv/config';
import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  GIT_CHECK_INTERVAL_MS,
  GIT_BRANCH,
  syncGitRepo,
  installDepsIfNeeded,
} from './git-sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IDLE_WAIT_MS = 5 * 1000;
const BATCH_COOLDOWN_MS = 3 * 1000;
const PROJECT_ROOT = path.resolve(__dirname, '../..');

let runCount = 0;
let childProcess: ChildProcess | null = null;
let lastGitCheck = 0;
let lastKnownHash = '';
const startTime = new Date();

function log(message: string): void {
  const now = new Date().toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  console.log(`[${now}] ${message}`);
}

function logHeader(): void {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 자동 업데이트 런처 (쇼핑 순위체크 전용)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 호스트: ${os.hostname()}`);
  console.log(`📁 경로: ${PROJECT_ROOT}`);
  console.log(`⏰ 작업 없을 때 대기: ${IDLE_WAIT_MS / 1000}초`);
  console.log(`⚡ 배치 완료 후 쿨다운: ${BATCH_COOLDOWN_MS / 1000}초`);
  console.log(`🔄 Git 체크 주기: ${GIT_CHECK_INTERVAL_MS / 1000 / 60}분`);
  console.log(`🌿 Git 브랜치: ${GIT_BRANCH}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

async function checkForUpdates(): Promise<boolean> {
  const before = lastKnownHash;
  const result = await syncGitRepo(PROJECT_ROOT, { branch: GIT_BRANCH });

  if (result.localHash) {
    lastKnownHash = result.localHash;
  }

  if (result.updated) {
    log(`📦 Git 업데이트:\n${result.message}`);
    if (before && result.localHash) {
      try {
        await installDepsIfNeeded(PROJECT_ROOT, before, result.localHash);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        log(`⚠️ npm install: ${msg}`);
      }
    }
    return true;
  }

  if (!result.message.includes('실패')) {
    log(`✅ Git ${result.message}`);
  } else {
    log(`⚠️ ${result.message}`);
  }
  return false;
}

async function maybeSyncGit(): Promise<void> {
  const now = Date.now();
  if (now - lastGitCheck < GIT_CHECK_INTERVAL_MS) return;
  lastGitCheck = now;
  const updated = await checkForUpdates();
  if (updated) {
    log('🔄 코드 업데이트됨 — 다음 배치부터 반영');
  }
}

async function runRankCheck(): Promise<number> {
  return new Promise((resolve) => {
    log('🔍 순위 체크 시작...');

    const scriptPath = path.join(
      PROJECT_ROOT,
      'rank-check',
      'batch',
      'check-batch-keywords.ts'
    );

    let output = '';

    childProcess = spawn(
      'npx',
      ['tsx', scriptPath, '--limit=1', '--once'],
      {
        cwd: PROJECT_ROOT,
        stdio: ['inherit', 'pipe', 'inherit'],
        shell: true,
        env: { ...process.env, BATCH_SIZE: '1', CLAIM_LIMIT: '1' },
      }
    );

    childProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      process.stdout.write(text);
      output += text;
    });

    childProcess.on('close', (code) => {
      childProcess = null;

      let processedCount = 0;
      const matchTotal = output.match(/총 처리:\s*(\d+)개/);
      const matchAssign = output.match(/(\d+)개 키워드 할당/);
      const matchNoWork = output.includes('처리할 키워드가 없습니다');

      if (matchNoWork) {
        processedCount = 0;
      } else if (matchTotal) {
        processedCount = parseInt(matchTotal[1], 10);
      } else if (matchAssign) {
        processedCount = parseInt(matchAssign[1], 10);
      }

      if (code === 0) {
        log(`✅ 순위 체크 완료 (${processedCount}개 처리)`);
      } else {
        log(`⚠️ 순위 체크 종료 (코드: ${code})`);
      }

      resolve(processedCount);
    });

    childProcess.on('error', (error) => {
      childProcess = null;
      log(`❌ 순위 체크 에러: ${error.message}`);
      resolve(0);
    });
  });
}

async function runOnce(): Promise<number> {
  runCount++;
  console.log('');
  console.log(`━━━━━━━━━━ [${runCount}회차 실행] ━━━━━━━━━━`);

  try {
    await maybeSyncGit();
    return await runRankCheck();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`🚨 에러 발생: ${msg}`);
    return 0;
  }
}

function printStats(): void {
  const uptime = Math.round((Date.now() - startTime.getTime()) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 런처 통계');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`시작 시간: ${startTime.toLocaleString('ko-KR')}`);
  console.log(`실행 시간: ${hours}시간 ${minutes}분 ${seconds}초`);
  console.log(`총 실행 횟수: ${runCount}회`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

function setupShutdownHandler(): void {
  const shutdown = (signal: string) => {
    log(`\n${signal} 신호 수신. 종료 중...`);
    if (childProcess) {
      childProcess.kill('SIGTERM');
    }
    printStats();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  logHeader();
  setupShutdownHandler();

  log('🔄 작업 감시 모드 (Ctrl+C 종료)');
  log(`   Git: ${GIT_CHECK_INTERVAL_MS / 60000}분마다 fetch/pull`);
  console.log('');

  lastGitCheck = 0;
  await maybeSyncGit();

  while (true) {
    const processedCount = await runOnce();

    if (processedCount === 0) {
      log(`⏳ 작업 없음. ${IDLE_WAIT_MS / 1000}초 후 재확인...`);
      await delay(IDLE_WAIT_MS);
    } else {
      log(`⚡ ${BATCH_COOLDOWN_MS / 1000}초 쿨다운 후 다음 배치...`);
      await delay(BATCH_COOLDOWN_MS);
    }
  }
}

main().catch((error) => {
  console.error('🚨 치명적 에러:', error.message);
  process.exit(1);
});
