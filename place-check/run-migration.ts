#!/usr/bin/env npx tsx
/** slot_rank_place_history 마이그레이션 (review 컬럼, category 컬럼) */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(process.cwd(), '.env') });
import pg from 'pg';
import * as fs from 'fs';

const { Client } = pg;

const MIGRATIONS = [
  'add_place_review_columns.sql',
  'add_place_category_column.sql',
];

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL 또는 DIRECT_URL 환경 변수가 필요합니다.');
    process.exit(1);
  }

  const migrationsDir = path.join(process.cwd(), 'docs', 'migrations');
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();
    for (const file of MIGRATIONS) {
      const sqlPath = path.join(migrationsDir, file);
      if (!fs.existsSync(sqlPath)) {
        console.warn(`⚠️ ${file} 없음, 스킵`);
        continue;
      }
      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log(`\n📄 ${file}`);
      for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        if (stmt.startsWith('--')) continue;
        await client.query(stmt);
        console.log('✅ 실행:', stmt.slice(0, 60) + '...');
      }
    }
    console.log('\n✅ 마이그레이션 완료');
  } catch (e: any) {
    console.error('❌ 마이그레이션 실패:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
