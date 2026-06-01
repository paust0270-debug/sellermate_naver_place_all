#!/usr/bin/env npx tsx
/**
 * 원격 PC / EXE용 감시 런처
 *
 * - 시작 시 + 5분마다 Git origin/main 변경 감지 → pull/reset → 로컬 반영
 * - package.json 변경 시 npm install
 * - 최신 코드로 run-unified.ts(통합 러너) 자식 프로세스 실행
 * - 업데이트 감지 시 자식 종료 후 재시작
 *
 * 사용:
 *   npx tsx rank-check/launcher/remote-watch-launcher.ts
 *   start-remote.bat
 */
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  GIT_CHECK_INTERVAL_MS,
  GIT_BRANCH,
  syncGitRepo,
  installDepsIfNeeded,
} from './git-sync';
import { buildEnvWithProjectFile } from '../utils/load-project-env';
import { verifySupabaseInstall } from '../utils/verify-supabase-install';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const RUN_SCRIPT = process.env.LAUNCHER_RUN_SCRIPT || 'run-unified.ts';
const GIT_HARD_RESET = process.env.GIT_SYNC_HARD_RESET !== '0'; // 원격 PC 기본: hard reset

let worker: ChildProcess | null = null;
let lastSyncAt = 0;
let lastKnownHash = '';
let isShuttingDown = false;
let isRestarting = false;

function log(message: string): void {
  const now = new Date().toLocaleString('ko-KR', { hour12: false });
  console.log(`[${now}] ${message}`);
}

function logHeader(): void {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🖥️  원격 감시 런처 (Git 5분 + 통합 실행)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 호스트: ${os.hostname()}`);
  console.log(`📁 경로: ${PROJECT_ROOT}`);
  console.log(`🌿 브랜치: ${GIT_BRANCH}`);
  console.log(`🔄 Git 확인 주기: ${GIT_CHECK_INTERVAL_MS / 1000 / 60}분`);
  console.log(`📜 실행 스크립트: ${RUN_SCRIPT}`);
  console.log(`🔧 Git 반영: ${GIT_HARD_RESET ? 'fetch + reset --hard' : 'fetch + pull'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

function runnerEnv(): NodeJS.ProcessEnv {
  return buildEnvWithProjectFile(PROJECT_ROOT, {
    GIT_SYNC_HARD_RESET: process.env.GIT_SYNC_HARD_RESET ?? '1',
    GIT_CHECK_INTERVAL_MS: process.env.GIT_CHECK_INTERVAL_MS ?? String(GIT_CHECK_INTERVAL_MS),
  });
}

async function ensureSupabaseBeforeWorker(): Promise<void> {
  const envPath = path.join(PROJECT_ROOT, '.env');
  while (!isShuttingDown) {
    log('🔍 Supabase 연결 확인...');
    const verify = await verifySupabaseInstall(PROJECT_ROOT);
    if (verify.ok) {
      log(`✅ ${verify.message}`);
      return;
    }
    log(`❌ Supabase 연결 실패 — ${verify.message}`);
    log(`   .env: ${envPath}`);
    log('   → 30초 후 재시도');
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

function getTsxCommand(scriptPath: string): { command: string; args: string[] } {
  const localTsx = path.join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (fs.existsSync(localTsx)) {
    return { command: 'node', args: [localTsx, scriptPath] };
  }
  return { command: 'npx', args: ['tsx', scriptPath] };
}

function killWorkerTree(): Promise<void> {
  return new Promise((resolve) => {
    if (!worker) {
      resolve();
      return;
    }

    const child = worker;
    worker = null;

    const done = () => resolve();

    child.once('close', done);
    child.once('error', done);

    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        shell: true,
        stdio: 'ignore',
      }).on('close', () => {
        setTimeout(done, 1500);
      });
    } else {
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
        done();
      }, 8000);
    }
  });
}

async function applyGitSync(forceLog = true): Promise<boolean> {
  const beforeHash = lastKnownHash;
  const result = await syncGitRepo(PROJECT_ROOT, {
    branch: GIT_BRANCH,
    hardReset: GIT_HARD_RESET,
  });

  lastSyncAt = Date.now();

  if (result.localHash) {
    lastKnownHash = result.localHash;
  }

  if (forceLog) {
    if (result.updated) {
      log(`📦 Git 업데이트 반영: ${result.message}`);
    } else if (!result.message.includes('실패')) {
      log(`✅ Git ${result.message}`);
    } else {
      log(`⚠️ ${result.message}`);
    }
  }

  if (result.updated && beforeHash && result.localHash) {
    try {
      const installed = await installDepsIfNeeded(
        PROJECT_ROOT,
        beforeHash,
        result.localHash
      );
      if (installed) {
        log('📦 package.json 변경 → npm install 완료');
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`⚠️ npm install 실패: ${msg}`);
    }
  }

  return result.updated;
}

function startWorker(): void {
  if (isShuttingDown || worker) return;

  const scriptPath = path.join(PROJECT_ROOT, RUN_SCRIPT);
  if (!fs.existsSync(scriptPath)) {
    log(`❌ 실행 파일 없음: ${scriptPath}`);
    process.exit(1);
  }

  const { command, args } = getTsxCommand(scriptPath);
  log(`▶️ 통합 러너 시작: ${command} ${args.join(' ')}`);

  worker = spawn(command, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: false,
    env: runnerEnv(),
  });

  worker.on('close', (code) => {
    worker = null;
    if (isShuttingDown) return;
    if (isRestarting) {
      isRestarting = false;
      startWorker();
      return;
    }
    log(`⚠️ 통합 러너 종료 (코드: ${code ?? '?'}) — 5초 후 재시작`);
    setTimeout(() => {
      if (!isShuttingDown) startWorker();
    }, 5000);
  });

  worker.on('error', (error) => {
    worker = null;
    log(`❌ 통합 러너 실행 오류: ${error.message}`);
  });
}

async function restartWorkerAfterUpdate(): Promise<void> {
  if (isRestarting) return;
  isRestarting = true;
  log('🔄 코드 업데이트 → 실행 중인 러너 재시작...');
  await killWorkerTree();
  startWorker();
}

async function periodicGitCheck(): Promise<void> {
  if (isShuttingDown) return;

  const now = Date.now();
  if (now - lastSyncAt < GIT_CHECK_INTERVAL_MS) {
    return;
  }

  const updated = await applyGitSync(true);
  if (updated) {
    await restartWorkerAfterUpdate();
  }
}

async function main(): Promise<void> {
  logHeader();

  log('🔍 시작 시 Git 동기화...');
  await applyGitSync(true);

  await ensureSupabaseBeforeWorker();

  startWorker();

  const timer = setInterval(() => {
    periodicGitCheck().catch((error) => {
      log(`⚠️ Git 주기 확인 오류: ${error.message}`);
    });
  }, 60_000); // 1분마다 “5분 경과했는지” 확인

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    clearInterval(timer);
    log(`${signal} 수신 — 종료 중...`);
    await killWorkerTree();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('🚨 치명적 오류:', error);
  process.exit(1);
});
