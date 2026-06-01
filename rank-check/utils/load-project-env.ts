import * as fs from 'fs';
import * as path from 'path';

function unquote(value: string): string {
  const v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1).trim();
  }
  return v;
}

function parseEnvContent(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = unquote(trimmed.slice(eq + 1));
    if (key) out[key] = value;
  }
  return out;
}

export function applyEnvAliases(out: Record<string, string>): Record<string, string> {
  if (!out.SUPABASE_URL && out.NEXT_PUBLIC_SUPABASE_URL) {
    out.SUPABASE_URL = out.NEXT_PUBLIC_SUPABASE_URL;
  }
  if (!out.SUPABASE_SERVICE_ROLE_KEY && out.SUPABASE_ANON_KEY) {
    out.SUPABASE_SERVICE_ROLE_KEY = out.SUPABASE_ANON_KEY;
  }
  return out;
}

export function loadEnvFileFromPath(envFilePath: string): Record<string, string> {
  if (!fs.existsSync(envFilePath)) return {};
  return applyEnvAliases(parseEnvContent(fs.readFileSync(envFilePath, 'utf8')));
}

/** 설치 폴더 .env 파싱 (따옴표 제거 — EXE 부트스트랩과 동일 규칙) */
export function loadProjectEnvFile(rootDir: string): Record<string, string> {
  return loadEnvFileFromPath(path.join(rootDir, '.env'));
}

export function isLegacyJwtServiceKey(key: string | undefined): boolean {
  return !!key && key.startsWith('eyJ');
}

const ENV_KEYS_TO_WRITE = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

export function writeEnvFile(envFilePath: string, vars: Record<string, string>): void {
  const lines: string[] = [];
  for (const key of ENV_KEYS_TO_WRITE) {
    if (vars[key]) lines.push(`${key}=${vars[key]}`);
  }
  fs.writeFileSync(envFilePath, `${lines.join('\n')}\n`, 'utf8');
}

/** 복사 배포용 .env.defaults / deploy/local.env */
export function findBundledEnvForInstall(installDir: string): Record<string, string> | null {
  const candidates = [
    path.join(installDir, '.env.defaults'),
    path.join(installDir, 'deploy', 'local.env'),
  ];
  for (const filePath of candidates) {
    const env = loadEnvFileFromPath(filePath);
    if (
      env.SUPABASE_URL &&
      env.SUPABASE_SERVICE_ROLE_KEY &&
      !isLegacyJwtServiceKey(env.SUPABASE_SERVICE_ROLE_KEY)
    ) {
      return env;
    }
  }
  return null;
}

/** process.env에 .env 병합 (자식 프로세스 spawn용) */
export function buildEnvWithProjectFile(
  rootDir: string,
  extra: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const fileEnv = loadProjectEnvFile(rootDir);
  return { ...process.env, ...fileEnv, ...extra };
}
