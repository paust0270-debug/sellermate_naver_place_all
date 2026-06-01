/**
 * Git 원격 동기화 (원격 PC / EXE 런처 공용)
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

/** 기본: 5분마다 업데이트 확인 */
export const GIT_CHECK_INTERVAL_MS = Number(
  process.env.GIT_CHECK_INTERVAL_MS || 5 * 60 * 1000
);

export const GIT_BRANCH = process.env.GIT_BRANCH || 'main';

export interface GitSyncResult {
  updated: boolean;
  localHash: string;
  remoteHash: string;
  message: string;
}

async function runGit(
  projectRoot: string,
  args: string,
  timeoutMs = 120_000
): Promise<string> {
  const { stdout } = await execAsync(`git -C "${projectRoot}" ${args}`, {
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });
  return (stdout || '').trim();
}

/**
 * origin/{branch} 와 로컬 HEAD 비교 후 변경 시 pull (원격 PC는 hard reset 옵션)
 */
export async function syncGitRepo(
  projectRoot: string,
  options: { branch?: string; hardReset?: boolean } = {}
): Promise<GitSyncResult> {
  const branch = options.branch || GIT_BRANCH;
  const hardReset = options.hardReset ?? process.env.GIT_SYNC_HARD_RESET === '1';

  if (!fs.existsSync(path.join(projectRoot, '.git'))) {
    return {
      updated: false,
      localHash: '',
      remoteHash: '',
      message: 'Git 저장소가 아님 (.git 없음)',
    };
  }

  try {
    await runGit(projectRoot, `fetch origin ${branch}`);

    const localHash = await runGit(projectRoot, 'rev-parse HEAD');
    const remoteHash = await runGit(projectRoot, `rev-parse origin/${branch}`);

    if (localHash === remoteHash) {
      return {
        updated: false,
        localHash,
        remoteHash,
        message: '최신 상태',
      };
    }

    let pullLog = '';
    if (hardReset) {
      pullLog = await runGit(projectRoot, `reset --hard origin/${branch}`);
    } else {
      pullLog = await runGit(projectRoot, `pull origin ${branch}`);
    }

    const newHash = await runGit(projectRoot, 'rev-parse HEAD');

    return {
      updated: true,
      localHash: newHash,
      remoteHash,
      message: pullLog || `업데이트 완료 (${localHash.slice(0, 7)} → ${newHash.slice(0, 7)})`,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      updated: false,
      localHash: '',
      remoteHash: '',
      message: `Git 동기화 실패: ${msg}`,
    };
  }
}

/**
 * package-lock.json 변경 시 npm install
 */
export async function installDepsIfNeeded(
  projectRoot: string,
  beforeHash: string,
  afterHash: string
): Promise<boolean> {
  if (!beforeHash || !afterHash || beforeHash === afterHash) {
    return false;
  }

  try {
    const diff = await runGit(
      projectRoot,
      `diff ${beforeHash} ${afterHash} --name-only -- package.json package-lock.json`,
      30_000
    );
    if (!diff.includes('package.json') && !diff.includes('package-lock.json')) {
      return false;
    }
  } catch {
    return false;
  }

  const npmCmd =
    process.platform === 'win32' ? 'npm install --legacy-peer-deps' : 'npm install';

  await execAsync(npmCmd, {
    cwd: projectRoot,
    timeout: 600_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return true;
}
