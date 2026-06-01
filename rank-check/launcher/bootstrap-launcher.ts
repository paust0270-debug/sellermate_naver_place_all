/**
 * EXE용 부트스트랩 런처 (원격 PC 배포용)
 *
 * 텔레그램으로 EXE 전달 → 더블클릭만으로:
 * 1. D:\naverrank 폴더 생성
 * 2. Git clone/pull
 * 3. .env 파일 자동 생성 (하드코딩된 값)
 * 4. npm install
 * 5. Git 5분 감시 + 통합 러너 24시간 실행 (remote-watch-launcher)
 *
 * 요구사항: Node.js, Git
 */

import { execSync, spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { syncGitRepo, GIT_CHECK_INTERVAL_MS } from './git-sync';
import {
  loadProjectEnvFile,
  buildEnvWithProjectFile,
  findBundledEnvForInstall,
  isLegacyJwtServiceKey,
  writeEnvFile,
} from '../utils/load-project-env';
import { EMBEDDED_INSTALL_ENV } from './embedded-install-env';
import { verifySupabaseInstall } from '../utils/verify-supabase-install';

// ============ 설정 ============
const GIT_REPO =
  process.env.NAVER_RANK_GIT_REPO ||
  'https://github.com/paust0270-debug/sellermate_naver_place_all.git';
const GIT_BRANCH = process.env.GIT_BRANCH || 'main';

/** D: 없으면 %LOCALAPPDATA%\SellermateNaverRank 사용 */
function resolveInstallDir(): string {
  if (process.env.NAVER_RANK_INSTALL_DIR?.trim()) {
    return path.resolve(process.env.NAVER_RANK_INSTALL_DIR.trim());
  }
  if (fs.existsSync('D:\\')) {
    return 'D:\\naverrank';
  }
  const localApp =
    process.env.LOCALAPPDATA ||
    path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localApp, 'SellermateNaverRank');
}

const INSTALL_DIR = resolveInstallDir();

// ============ 유틸리티 ============
function log(message: string): void {
  const timestamp = new Date().toLocaleTimeString('ko-KR');
  console.log(`[${timestamp}] ${message}`);
}

/** 더블클릭 실행 시 오류 메시지를 볼 수 있게 대기 */
function exitWithPause(code: number): never {
  if (process.platform === 'win32' && process.env.NAVER_RANK_NO_PAUSE !== '1') {
    console.log('');
    try {
      execSync('cmd /c pause', { stdio: 'inherit' });
    } catch {}
  }
  process.exit(code);
}

function buildChildEnv(): NodeJS.ProcessEnv {
  return buildEnvWithProjectFile(INSTALL_DIR, {
    GIT_SYNC_HARD_RESET: '1',
    GIT_CHECK_INTERVAL_MS: String(5 * 60 * 1000),
  });
}

/** 통합 러너 우선, 쇼핑 전용 auto-update는 최후 */
function resolveLauncherScript(): string | null {
  const candidates = [
    'rank-check/launcher/remote-watch-launcher.ts',
    'run-unified.ts',
    'rank-check/launcher/auto-update-launcher.ts',
  ];
  for (const rel of candidates) {
    if (fs.existsSync(path.join(INSTALL_DIR, rel))) {
      return rel;
    }
  }
  return null;
}

function isUnifiedLauncher(rel: string): boolean {
  return (
    rel.includes('remote-watch') ||
    rel === 'run-unified.ts' ||
    rel.endsWith('run-unified.ts')
  );
}

function killChildTree(child: ChildProcess | null): void {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore', windowsHide: true });
    } catch {}
  } else {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
}

/** 시스템에 설치된 node.exe (pkg EXE는 PATH에 node가 없을 수 있음) */
function findNodeBin(): string {
  try {
    const out = execSync('where node', {
      encoding: 'utf8',
      shell: true,
      windowsHide: true,
    }).trim();
    const first = out.split(/\r?\n/).find((line) => line.trim().endsWith('node.exe'));
    if (first?.trim() && fs.existsSync(first.trim())) {
      return first.trim();
    }
  } catch {}
  return 'node';
}

function getTsxSpawn(scriptRel: string): {
  command: string;
  args: string[];
  shell: boolean;
} {
  const scriptPath = path.join(INSTALL_DIR, scriptRel);
  const nodeBin = findNodeBin();
  const localTsx = path.join(INSTALL_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const tsxCmd = path.join(INSTALL_DIR, 'node_modules', '.bin', 'tsx.cmd');

  if (fs.existsSync(localTsx)) {
    return { command: nodeBin, args: [localTsx, scriptPath], shell: false };
  }
  if (fs.existsSync(tsxCmd)) {
    return { command: tsxCmd, args: [scriptPath], shell: true };
  }

  // tsx 미설치 시 (Windows: npx는 .cmd라 shell 필요)
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npx', 'tsx', scriptRel],
      shell: false,
    };
  }
  return { command: 'npx', args: ['tsx', scriptRel], shell: true };
}

function runCommand(
  command: string,
  options: { cwd?: string; silent?: boolean; env?: NodeJS.ProcessEnv } = {}
): boolean {
  try {
    execSync(command, {
      cwd: options.cwd || INSTALL_DIR,
      stdio: options.silent ? 'pipe' : 'inherit',
      encoding: 'utf8',
      shell: true,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    return true;
  } catch {
    return false;
  }
}

function normalizeGitRemoteUrl(url: string): string {
  return url
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/$/, '')
    .toLowerCase()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/');
}

/** 예전 Rank_Updator 등 잘못된 origin이면 sellermate 저장소로 교정 */
function ensureGitOrigin(): void {
  const gitDir = path.join(INSTALL_DIR, '.git');
  if (!fs.existsSync(gitDir)) return;

  let current = '';
  try {
    current = execSync('git config --get remote.origin.url', {
      cwd: INSTALL_DIR,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    current = '';
  }

  const want = normalizeGitRemoteUrl(GIT_REPO);
  const have = normalizeGitRemoteUrl(current || '');

  if (!have || have !== want) {
    if (current) log(`Git origin 교정: ${current}`);
    log(`→ ${GIT_REPO}`);
    runCommand(`git remote set-url origin "${GIT_REPO}"`, { cwd: INSTALL_DIR });
  } else {
    log(`Git origin OK (${current})`);
  }
}

// ============ 메인 ============
async function main(): Promise<void> {
  console.log('');
  console.log('='.repeat(50));
  console.log('  NaverRank Checker - Auto Installer');
  console.log('='.repeat(50));
  console.log('');

  console.log(`설치 경로: ${INSTALL_DIR}`);
  if (!fs.existsSync('D:\\')) {
    log('D: 드라이브 없음 → 사용자 폴더에 설치합니다.');
  }

  // 1. 설치 폴더 생성/확인
  console.log('-'.repeat(50));
  log(`[1/5] 설치 폴더: ${INSTALL_DIR}`);
  console.log('-'.repeat(50));

  if (!fs.existsSync(INSTALL_DIR)) {
    log('폴더 생성 중...');
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    log('폴더 생성 완료');
  } else {
    log('기존 폴더 발견');
  }

  // 3. Git clone/pull
  console.log('');
  console.log('-'.repeat(50));
  log('[2/5] Git 업데이트');
  console.log('-'.repeat(50));

  // Git 설치 확인
  if (!runCommand('git --version', { silent: true, cwd: os.homedir() })) {
    console.log('[오류] Git이 설치되어 있지 않습니다.');
    console.log('https://git-scm.com/download/win 에서 설치해주세요.');
    exitWithPause(1);
  }

  const gitDir = path.join(INSTALL_DIR, '.git');
  const installParent = path.dirname(INSTALL_DIR);

  if (fs.existsSync(gitDir)) {
    ensureGitOrigin();
    log('git fetch...');
    runCommand(`git fetch origin ${GIT_BRANCH}`, { cwd: INSTALL_DIR });
    log('git reset --hard...');
    runCommand(`git reset --hard origin/${GIT_BRANCH}`, { cwd: INSTALL_DIR });
    log('Git 업데이트 완료');
  } else {
    if (!fs.existsSync(installParent)) {
      fs.mkdirSync(installParent, { recursive: true });
    }
    log(`git clone → ${INSTALL_DIR}`);
    if (!runCommand(`git clone ${GIT_REPO} "${INSTALL_DIR}"`, { cwd: installParent })) {
      console.log('[오류] Git clone 실패');
      console.log('  - 인터넷 / GitHub 접속 확인');
      console.log('  - 또는 수동 clone 후 NAVER_RANK_INSTALL_DIR 환경변수로 경로 지정');
      exitWithPause(1);
    }
    log('Git clone 완료');
  }

  // 4. .env 파일 생성
  console.log('');
  console.log('-'.repeat(50));
  log('[3/5] 환경 설정 (.env)');
  console.log('-'.repeat(50));

  const envPath = path.join(INSTALL_DIR, '.env');
  const envExample = path.join(INSTALL_DIR, '.env.example');
  const bundledEnv = findBundledEnvForInstall(INSTALL_DIR) ?? EMBEDDED_INSTALL_ENV;

  if (fs.existsSync(envPath)) {
    const current = loadProjectEnvFile(INSTALL_DIR);
    if (isLegacyJwtServiceKey(current.SUPABASE_SERVICE_ROLE_KEY) && bundledEnv) {
      writeEnvFile(envPath, bundledEnv);
      log('예전 Legacy JWT .env → 설치기 내장 키로 자동 교체');
    } else if (!isLegacyJwtServiceKey(current.SUPABASE_SERVICE_ROLE_KEY)) {
      log('기존 .env 유지 (sb_secret_ 키 확인됨)');
    }
  } else if (bundledEnv) {
    writeEnvFile(envPath, bundledEnv);
    log('.env 없음 → 내장/기본 키로 생성');
  } else if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envPath);
    log('.env를 .env.example에서 복사했습니다.');
    console.log('  → Supabase 키(sb_secret_ / sb_publishable_)를 .env에 입력 후 다시 실행하세요.');
    exitWithPause(1);
  } else {
    fs.writeFileSync(
      envPath,
      [
        'SUPABASE_URL=https://your-project.supabase.co',
        'SUPABASE_SERVICE_ROLE_KEY=sb_secret_your-key',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_your-key',
      ].join('\n'),
      'utf8'
    );
    log('.env 템플릿 생성 — 키 입력 후 다시 실행하세요.');
    exitWithPause(1);
  }

  const fileEnv = loadProjectEnvFile(INSTALL_DIR);
  if (!fileEnv.SUPABASE_URL || !fileEnv.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[오류] .env에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
    console.log(`  경로: ${envPath}`);
    exitWithPause(1);
  }

  // 5. 의존성 설치
  console.log('');
  console.log('-'.repeat(50));
  log('[4/5] 의존성 설치');
  console.log('-'.repeat(50));

  // npm 설치 확인
  if (!runCommand('npm --version', { silent: true, cwd: INSTALL_DIR })) {
    console.log('[오류] npm이 설치되어 있지 않습니다.');
    console.log('https://nodejs.org 에서 Node.js를 설치해주세요.');
    exitWithPause(1);
  }

  log('npm install... (시간이 걸릴 수 있습니다, tsx 포함 devDependencies)');
  const installOk = runCommand(
    'npm install --legacy-peer-deps --include=dev',
    {
      cwd: INSTALL_DIR,
      env: {
        NPM_CONFIG_PRODUCTION: 'false',
        NODE_ENV: 'development',
      },
    }
  );
  if (installOk) {
    log('의존성 설치 완료');
  } else {
    console.log('[경고] npm install 실패');
    console.log('기존 node_modules로 계속 시도합니다.');
  }

  const tsxCli = path.join(INSTALL_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!fs.existsSync(tsxCli)) {
    log('tsx 없음 → 추가 설치 시도...');
    runCommand('npm install tsx@^4.7.0 --save-dev --legacy-peer-deps', {
      cwd: INSTALL_DIR,
      env: { NPM_CONFIG_PRODUCTION: 'false' },
    });
  }

  console.log('');
  console.log('-'.repeat(50));
  log('Supabase 연결 확인');
  console.log('-'.repeat(50));
  let verify = await verifySupabaseInstall(INSTALL_DIR);
  if (!verify.ok && bundledEnv) {
    writeEnvFile(envPath, bundledEnv);
    log('잘못된 API 키 .env → 설치기 내장 키로 교체');
    verify = await verifySupabaseInstall(INSTALL_DIR);
  }
  if (!verify.ok) {
    console.log('');
    console.log('[오류] Supabase에 연결할 수 없습니다.');
    console.log(`  ${verify.message}`);
    console.log(`  .env: ${envPath}`);
    console.log('  → deploy\\local.env 키 확인 후 EXE 재빌드 또는 APPLY-TO-D-NAVERRANK.bat');
    exitWithPause(1);
  }
  log(`✅ ${verify.message}`);

  // 6. 순위 체크 실행
  console.log('');
  console.log('-'.repeat(50));
  log('[5/5] 원격 감시 런처 시작 (Git 5분 + 통합 실행)');
  console.log('-'.repeat(50));

  const launcherRel = resolveLauncherScript();
  if (!launcherRel) {
    console.log('[오류] 런처 스크립트를 찾을 수 없습니다.');
    console.log('  GitHub main에 최신 코드가 push 되었는지 확인하세요.');
    console.log(`  설치 폴더: ${INSTALL_DIR}`);
    exitWithPause(1);
  }

  if (!isUnifiedLauncher(launcherRel)) {
    console.log('');
    console.log('[오류] 구버전 저장소/런처(auto-update)만 있습니다. 통합 러너를 사용할 수 없습니다.');
    console.log(`  현재 Git origin이 ${GIT_REPO} 인지 확인 후 EXE를 다시 실행하세요.`);
    console.log('  수동 교정:');
    console.log(`    cd "${INSTALL_DIR}"`);
    console.log(`    git remote set-url origin ${GIT_REPO}`);
    console.log(`    git fetch origin ${GIT_BRANCH} && git reset --hard origin/${GIT_BRANCH}`);
    exitWithPause(1);
  }

  const unified = isUnifiedLauncher(launcherRel);
  const useBootstrapGitWatch =
    unified && !launcherRel.includes('remote-watch');

  log(`실행: ${launcherRel}`);
  console.log('');
  console.log('='.repeat(50));
  if (unified) {
    console.log('  통합 러너: 쇼핑(유료)→쿠팡(유료)→플레이스(유료)→플레이스(무료)→쇼핑(무료)→쿠팡(무료)');
    console.log(
      useBootstrapGitWatch
        ? '  Git 5분마다 업데이트 (부트스트랩 감시)'
        : '  Git 5분마다 업데이트 (remote-watch-launcher)'
    );
  } else {
    console.log('  ⚠️ 쇼핑 순위체크만 실행 (구버전 auto-update-launcher)');
    console.log('  통합 실행: run-unified.ts 가 설치 폴더에 있는지 확인하세요.');
  }
  console.log('  종료: Ctrl+C');
  console.log('='.repeat(50));
  console.log('');

  let child: ChildProcess | null = null;
  let lastGitCheck = 0;
  let shuttingDown = false;

  const startChild = () => {
    const { command, args, shell } = getTsxSpawn(launcherRel);
    log(`▶️ ${command} ${args.join(' ')}`);

    child = spawn(command, args, {
      cwd: INSTALL_DIR,
      stdio: 'inherit',
      shell,
      windowsHide: false,
      env: buildChildEnv(),
    });

    child.on('error', (error) => {
      console.log(`[오류] 실행 실패: ${error.message}`);
      exitWithPause(1);
    });

    child.on('close', (code) => {
      child = null;
      if (shuttingDown) {
        process.exit(code || 0);
        return;
      }
      log(`프로세스 종료 (코드: ${code ?? '?'}) — 5초 후 재시작`);
      setTimeout(() => {
        if (!shuttingDown) startChild();
      }, 5000);
    });
  };

  startChild();

  if (useBootstrapGitWatch) {
    setInterval(async () => {
      if (shuttingDown) return;
      const now = Date.now();
      if (now - lastGitCheck < GIT_CHECK_INTERVAL_MS) return;
      lastGitCheck = now;
      const result = await syncGitRepo(INSTALL_DIR, { hardReset: true });
      if (result.updated) {
        log(`Git 업데이트 → 통합 러너 재시작 (${result.message})`);
        killChildTree(child);
        child = null;
        setTimeout(() => {
          if (!shuttingDown) startChild();
        }, 2000);
      }
    }, 60_000);
  }

  process.on('SIGINT', () => {
    shuttingDown = true;
    console.log('');
    log('종료 신호 수신...');
    killChildTree(child);
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[오류]', error);
  exitWithPause(1);
});
