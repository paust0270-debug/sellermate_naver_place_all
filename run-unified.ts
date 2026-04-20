#!/usr/bin/env npx tsx
/**
 * 쇼핑 + 쇼핑트레픽 + 쿠팡 + 플레이스 통합 러너 (이 폴더만 사용)
 * - 순차: 쇼핑(유료) → 쇼핑트레픽(유료) → 쿠팡(유료) → 플레이스(유료) → 플레이스(무료) → 쇼핑(무료) → 쿠팡(무료) → 반복
 * - 쇼핑트레픽: shopping-traffic/unified-runner.ts (이 폴더 내장, 워커 1개 --once)
 * - 동시에 여러 창 안 뜨도록 단일 실행 잠금 적용
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);
const LOCK_FILE = path.join(ROOT, '.unified-runner.lock');


function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true; // 신호 전송 성공 = 프로세스 존재 (Unix)
  } catch {
    return false; // 프로세스 없음 또는 권한 없음
  }
}

function acquireLock(): boolean {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const raw = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      const pid = parseInt(raw, 10);
      if (!Number.isNaN(pid) && isPidAlive(pid)) {
        return false; // 다른 러너가 실제로 실행 중
      }
      // 잠금 파일만 남아 있고 해당 프로세스는 없음(비정상 종료 등) → 잠금 제거 후 진행
      try {
        fs.unlinkSync(LOCK_FILE);
      } catch {}
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch {}
}

/** 이 폴더의 node_modules에서 tsx 실행 (dotenv 등 패키지 인식용) */
function getTsxArgs(scriptPath: string, scriptArgs: string[]): { command: string; args: string[] } {
  const localTsx = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const localTsxBin = path.join(ROOT, 'node_modules', '.bin', 'tsx.cmd');
  const localTsxBinSh = path.join(ROOT, 'node_modules', '.bin', 'tsx');
  if (fs.existsSync(localTsx)) {
    return { command: 'node', args: [localTsx, scriptPath, ...scriptArgs] };
  }
  if (fs.existsSync(localTsxBin)) {
    return { command: localTsxBin, args: [scriptPath, ...scriptArgs] };
  }
  if (fs.existsSync(localTsxBinSh)) {
    return { command: localTsxBinSh, args: [scriptPath, ...scriptArgs] };
  }
  return { command: 'npx', args: ['tsx', scriptPath, ...scriptArgs] };
}

function run(
  cwd: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, ...env },
      windowsHide: false,
    });
    child.on('close', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

async function runShoppingTrafficOnce(): Promise<number> {
  console.log('\n🚀 [통합] 쇼핑트레픽(유료) 1건 처리 시작...\n');
  const { command, args } = getTsxArgs('shopping-traffic/unified-runner.ts', ['--once']);
  const code = await run(ROOT, command, args, { PARALLEL_BROWSERS: '1' });
  console.log('\n🚀 [통합] 쇼핑트레픽(유료) 1건 처리 종료 (exit code:', code, ')\n');
  return code;
}

async function runCoupangOnce(): Promise<number> {
  console.log('\n🛍️ [통합] 쿠팡 1건 처리 시작...\n');
  const { command, args } = getTsxArgs('coupang-check/coupang-rank-processor.ts', ['--once']);
  const code = await run(ROOT, command, args);
  console.log('\n🛍️ [통합] 쿠팡 1건 처리 종료 (exit code:', code, ')\n');
  return code;
}

async function runShoppingOnce(): Promise<number> {
  console.log('\n🛒 [통합] 쇼핑 1건 처리 시작...\n');
  const { command, args } = getTsxArgs('rank-check/batch/check-batch-keywords.ts', ['--limit=1', '--once']);
  const code = await run(ROOT, command, args, { BATCH_SIZE: '1' });
  console.log('\n🛒 [통합] 쇼핑 1건 처리 종료 (exit code:', code, ')\n');
  return code;
}

async function runPlaceSlotOnce(): Promise<number> {
  console.log('\n📍 [통합] 플레이스(유료) 1건 처리 시작...\n');
  const { command, args } = getTsxArgs('place-check/batch/check-place-batch.ts', ['--slot-only', '--limit=1', '--once']);
  const code = await run(ROOT, command, args);
  console.log('\n📍 [통합] 플레이스(유료) 1건 처리 종료 (exit code:', code, ')\n');
  return code;
}

async function runPlaceFreeOnce(): Promise<number> {
  console.log('\n🆓 [통합] 플레이스(무료) 1건 처리 시작...\n');
  const { command, args } = getTsxArgs('place-check/batch/check-place-batch.ts', ['--free-only', '--limit=1', '--once']);
  const code = await run(ROOT, command, args);
  console.log('\n🆓 [통합] 플레이스(무료) 1건 처리 종료 (exit code:', code, ')\n');
  return code;
}

async function runShopFreeOnce(): Promise<number> {
  console.log('\n🛒🆓 [통합] 쇼핑(무료) 1건 처리 시작...\n');
  const { command, args } = getTsxArgs('rank-check/batch/check-free-navership-batch.ts', ['--limit=1', '--once']);
  const code = await run(ROOT, command, args);
  console.log('\n🛒🆓 [통합] 쇼핑(무료) 1건 처리 종료 (exit code:', code, ')\n');
  return code;
}

async function runCoupangFreeOnce(): Promise<number> {
  console.log('\n🛍️🆓 [통합] 쿠팡(무료) 1건 처리 시작...\n');
  const { command, args } = getTsxArgs('coupang-check/coupang-rank-processor.ts', ['--free-only']);
  const code = await run(ROOT, command, args);
  console.log('\n🛍️🆓 [통합] 쿠팡(무료) 1건 처리 종료 (exit code:', code, ')\n');
  return code;
}

const CYCLE_DELAY_MS = 3000;

async function main() {
  if (!acquireLock()) {
    console.error('❌ 이미 다른 통합 러너가 실행 중입니다. (한 번에 하나만 실행됩니다.)');
    console.error('   다른 터미널/창에서 run-unified(또는 npm start)를 종료하거나,');
    console.error('   실행 중인 게 없다면 프로젝트 루트의 .unified-runner.lock 파일을 삭제한 뒤 다시 시도하세요.');
    process.exit(1);
  }

  process.on('SIGINT', () => {
    releaseLock();
    console.log('\n⏹️ 통합 러너 중단 요청.');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    releaseLock();
    process.exit(0);
  });

  console.log('═══════════════════════════════════════════════════════');
  console.log('  쇼핑 + 쇼핑트레픽 + 쿠팡 + 플레이스 통합 러너 (순차 1건씩 무한 루프)');
  console.log('  쇼핑(유료) → 쇼핑트레픽(유료) → 쿠팡(유료) → 플레이스(유료) → 플레이스(무료) → 쇼핑(무료) → 쿠팡(무료)');
  console.log('  종료: Ctrl+C');
  console.log('═══════════════════════════════════════════════════════\n');

  let round = 0;

  try {
  while (true) {
    round++;
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  [통합] 라운드 ${round} — 쇼핑(유료) → 쇼핑트레픽(유료) → 쿠팡(유료) → 플레이스(유료) → 플레이스(무료) → 쇼핑(무료) → 쿠팡(무료)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    await runShoppingOnce();
    await runShoppingTrafficOnce();
    await runCoupangOnce();
    await runPlaceSlotOnce();
    await runPlaceFreeOnce();
    await runShopFreeOnce();
    await runCoupangFreeOnce();

    console.log('\n' + '='.repeat(50));
    console.log('🧹 [통합] 쿠키·캐시 초기화 (각 단계에서 브라우저 종료 시 정리됨)');
    console.log('='.repeat(50) + '\n');

    console.log(`\n⏳ 다음 라운드까지 ${CYCLE_DELAY_MS / 1000}초 대기...`);
    await new Promise((r) => setTimeout(r, CYCLE_DELAY_MS));
  }
  } finally {
    releaseLock();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
