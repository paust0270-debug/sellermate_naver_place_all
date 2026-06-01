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

/** 설치 폴더 .env 파싱 (따옴표 제거 — EXE 부트스트랩과 동일 규칙) */
export function loadProjectEnvFile(rootDir: string): Record<string, string> {
  const envPath = path.join(rootDir, '.env');
  const out: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return out;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = unquote(trimmed.slice(eq + 1));
    if (key) out[key] = value;
  }

  if (!out.SUPABASE_URL && out.NEXT_PUBLIC_SUPABASE_URL) {
    out.SUPABASE_URL = out.NEXT_PUBLIC_SUPABASE_URL;
  }
  if (!out.SUPABASE_SERVICE_ROLE_KEY && out.SUPABASE_ANON_KEY) {
    out.SUPABASE_SERVICE_ROLE_KEY = out.SUPABASE_ANON_KEY;
  }

  return out;
}

/** process.env에 .env 병합 (자식 프로세스 spawn용) */
export function buildEnvWithProjectFile(
  rootDir: string,
  extra: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const fileEnv = loadProjectEnvFile(rootDir);
  return { ...process.env, ...fileEnv, ...extra };
}
