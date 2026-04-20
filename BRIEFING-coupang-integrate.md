# 쿠팡 프로그램 통합 브리핑

**목표**
- `C:\Users\{C\Desktop\sellermate_copang_rank_1` 의 **메인 프로그램만** 가져와서  
  `C:\Users\{C\Desktop\sellermate_naver_place_all` 에 통합.
- 테스트/실험용 파일은 제외.
- 통합 러너 순서: **쿠팡 1건 → 쇼핑 1건 → 플레이스(유료) 1건 → 플레이스(무료) 1건 → 쇼핑(무료) 1건 → 대기 → 반복**.

---

## 1. 쿠팡 프로젝트 구조 (copang_rank_1)

### 1.1 메인 (가져올 것)

| 파일 | 용도 |
|------|------|
| **coupang-rank-processor.ts** | 쿠팡 순위 체크 메인. sellermate_keywords 조회(assigned_to 락) → Patchright 브라우저로 순위 체크 → 히스토리 저장 → 키워드 삭제. 무한 루프 + 창 개수(1/2) 입력. |

### 1.2 테스트/실험용 (제외)

| 파일 | 비고 |
|------|------|
| coupang-rank-processor-packet.ts | test:packet 용 — 제외 |
| run-test-packet.bat | 테스트 배치 — 제외 |
| test-batch.bat | 테스트 배치 — 제외 |
| test-product-extraction.ts | 테스트 스크립트 — 제외 |
| node-tls-client.d.ts | 타입 선언(필요 시만 복사) |

### 1.3 쿠팡 메인 동작 요약

- **테이블**: `sellermate_keywords` (slot_type IN '쿠팡','쿠팡VIP','쿠팡APP','쿠팡순위체크'), `assigned_to` 로 선점.
- **실행**: `askWindowCount()`(readline으로 1 또는 2 입력) → `processKeywordItems(windowCount)` 무한 루프.
- **1건 처리**: `fetchKeywordItem()` 1건 선점 → `processSingleItem()` (Patchright) → 히스토리 저장 → 키워드 삭제.
- **종료**: Ctrl+C 시에만 종료. **현재는 “1건만 처리하고 종료” 옵션 없음.**

---

## 2. place_all 쪽에서 할 작업

### 2.1 쿠팡 소스 배치

- **폴더**: `sellermate_naver_place_all/coupang-check/` (신규).
- **복사**: `coupang-rank-processor.ts` → `coupang-check/coupang-rank-processor.ts`.
- **선택**: 쿠팡 전용 유틸/타입이 더 있으면 같은 폴더에 두고, import 경로만 place_all 기준으로 수정.

### 2.2 쿠팡 메인에 “통합 1건 모드” 추가

통합 러너에서 **쿠팡 1건만 처리하고 바로 종료**하려면, 쿠팡 메인에 **`--once`(또는 `--unified`) 모드**를 넣어야 함.

- **진입점 분기**  
  - `process.argv`에 `--once`(또는 `--unified`) 있으면: **통합 1건 모드** 실행.  
  - 없으면: 기존처럼 `askWindowCount()` → `runWithAutoRestart()` (무한 루프 + 재시작).

- **통합 1건 모드 동작**  
  1. **readline 사용 안 함** — 창 개수 고정 1.  
  2. **processKeywordItems(1)** 호출.  
  3. **1회만 처리** 후 루프 탈출:  
     - `processKeywordItems(windowCount, once?: boolean)` 에서 `once === true` 이면  
       항목 가져와서 1건 처리한 뒤 `while (!shouldStop)` 한 번만 수행하고 `return`.  
     - 또는 항목 0건이면 그냥 종료.  
  4. **자동 재시작 없음** — `runWithAutoRestart()` 호출하지 않고, 1건 처리 후 `process.exit(0)`.

- **ESM 호환**  
  - place_all은 `"type": "module"` 이므로, 복사한 쿠팡 스크립트도 ESM으로 실행됨.  
  - 현재 쿠팡은 `if (require.main === module)` 사용 → **`import.meta.url` 기준 “직접 실행” 판단**으로 바꾸거나,  
    **항상 `process.argv`로 `--once` 여부만 보고** 분기하면 됨 (예: `node --loader tsx ...` / `tsx` 로 실행 시엔 `require.main`이 없을 수 있음).

요약: **`--once` 있으면 readline 없이 창 1개로 1건만 처리하고 exit(0).**

### 2.3 의존성 통합 (package.json)

- place_all `package.json`에 쿠팡용 의존성 추가:
  - **patchright** (쿠팡이 사용하는 브라우저 라이브러리)
  - 쿠팡에서만 쓰는 나머지 패키지(cheerio, node-tls-client 등)가 있으면 동일 버전으로 추가.
- `npm install` 한 번만 하면 쿠팡·네이버·플레이스 모두 같은 `node_modules` 사용.

### 2.4 환경 변수 / .env

- 쿠팡은 `SUPABASE_URL`(또는 `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`(또는 `SUPABASE_ANON_KEY`) 사용.
- place_all은 이미 `.env`에 Supabase 설정 있음 → **동일 .env 사용**하면 됨.  
  쿠팡이 `PC_ID` 등을 쓰면 기존 place_all 쪽과 충돌하지 않는 한 그대로 두거나, 통합 러너에서 `env: { PC_ID: 'unified' }` 등으로 넘겨도 됨.

### 2.5 통합 러너 수정 (run-unified.ts)

- **runCoupangOnce()** 추가:
  - 실행 경로: `coupang-check/coupang-rank-processor.ts` (또는 복사해 둔 경로).
  - 인자: `--once` (통합 1건 모드).
  - 기존 `getTsxArgs()` + `run(ROOT, command, args)` 패턴으로 자식 프로세스 실행, 종료 코드만 반환.
- **라운드 순서**를 아래처럼 변경:
  1. **runCoupangOnce()** — 쿠팡 1건  
  2. runShoppingOnce() — 쇼핑 1건  
  3. runPlaceSlotOnce() — 플레이스(유료) 1건  
  4. runPlaceFreeOnce() — 플레이스(무료) 1건  
  5. runShopFreeOnce() — 쇼핑(무료) 1건  
  6. 대기(예: 3초) 후 다음 라운드 반복.

---

## 3. 작업 순서 제안

| 순서 | 작업 |
|------|------|
| 1 | place_all에 `coupang-check/` 폴더 생성 후 `coupang-rank-processor.ts` 복사 (테스트/패킷 등 제외). |
| 2 | 복사한 파일 내부: `--once`(또는 `--unified`) 분기 추가, readline 생략, 창 1개로 1건만 처리 후 exit. |
| 3 | ESM/진입점: `require.main === module` 대신 `process.argv`/`import.meta` 등으로 “직접 실행” 처리 통일. |
| 4 | place_all `package.json`에 patchright 등 쿠팡 의존성 추가 후 `npm install`. |
| 5 | `run-unified.ts`에 `runCoupangOnce()` 추가 및 라운드 순서를 “쿠팡 1건 → 쇼핑 1건 → 플레이스 유료 → 플레이스 무료 → 쇼핑 무료 → 대기” 로 변경. |
| 6 | (선택) start.bat 문구를 “쿠팡 1건 → 쇼핑 1건 → …” 로 수정. |

---

## 4. 주의사항

- **테이블**: 쿠팡은 `sellermate_keywords` 사용. 네이버/플레이스는 `sellermate_keywords_navershopping`, `sellermate_keywords_place` 등 별도 테이블. DB가 같다면 그대로 두면 됨.
- **브라우저**: 쿠팡은 Patchright, 네이버/플레이스는 Puppeteer-real-browser. 서로 다른 프로세스에서 돌리므로 동시에 켜지면 창이 여러 개 뜰 수 있음. 순차 실행이면 1개씩만 동작.
- **실패 시**: 쿠팡 1건이 실패(항목 없음/에러)해도 exit code만 반환하고, 통합 러너는 다음 단계(쇼핑 1건)로 진행하는 식이면 됨.

---

## 5. 최종 실행 순서 (문구)

```
라운드 N:
  1. 쿠팡 1건           — coupang-check/coupang-rank-processor.ts --once
  2. 쇼핑(유료) 1건     — check-batch-keywords.ts --limit=1 --once
  3. 플레이스(유료) 1건 — check-place-batch.ts --slot-only --limit=1 --once
  4. 플레이스(무료) 1건 — check-place-batch.ts --free-only --limit=1 --once
  5. 쇼핑(무료) 1건     — check-free-navership-batch.ts --limit=1 --once
  → 대기 3초 → 라운드 N+1
```

이 순서대로 적용하면, 테스트 버전은 빼고 쿠팡 메인만 place_all로 가져와서 “쿠팡 1건 → 쇼핑 1건 → 플레이스 유료 → 플레이스 무료 → 쇼핑 무료 → 대기 → 반복”으로 통합할 수 있음.
