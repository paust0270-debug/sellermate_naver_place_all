# 프로그램 구동 로직 보고

## 1. 진입점 및 실행 방법

| 구분 | 내용 |
|------|------|
| **메인 진입** | `run-unified.ts` (통합 러너) |
| **실행 명령** | `npm start` 또는 `npm run` → `tsx run-unified.ts` |
| **Windows 실행** | `start.bat` 더블클릭 시 새 CMD 창에서 `npm start` 실행 |
| **단일 실행 제한** | `.unified-runner.lock` + PID로 동시에 하나만 실행 (중복 실행 시 에러 후 종료) |

---

## 2. 통합 러너 실행 순서 (무한 루프)

매 라운드마다 **아래 순서대로 1건씩** 순차 실행 후, 3초 대기하고 다음 라운드로 반복합니다.

| 순서 | 단계 | 스크립트 | 데이터 소스 | 비고 |
|------|------|----------|-------------|------|
| 1 | 쇼핑(유료) | `rank-check/batch/check-batch-keywords.ts` | `sellermate_keywords_navershopping` | `--limit=1 --once`, BATCH_SIZE=1 |
| 2 | 쇼핑트레픽(유료) | `shopping-traffic/unified-runner.ts` | `sellermate_traffic_navershopping` | `--once`, 워커 1개 |
| 3 | 쿠팡(유료) | `coupang-check/coupang-rank-processor.ts` | `sellermate_keywords` (slot_type 쿠팡류) | `--once` |
| 4 | 플레이스(유료) | `place-check/batch/check-place-batch.ts` | `sellermate_keywords_place` (slot_id) | `--slot-only --limit=1 --once` |
| 5 | 플레이스(무료) | `place-check/batch/check-place-batch.ts` | `sellermate_keywords_place` (free_place_id) | `--free-only --limit=1 --once` |
| 6 | 쇼핑(무료) | `rank-check/batch/check-free-navership-batch.ts` | `sellermate_keywords_navershopping` (free_navershopping_id) | `--limit=1 --once` |
| 7 | 쿠팡(무료) | `coupang-check/coupang-rank-processor.ts` | `sellermate_keywords` (free_coupang_id) | `--free-only` |

- **라운드 간격**: 각 단계 종료 후 다음 라운드까지 **3초**(`CYCLE_DELAY_MS`) 대기.
- **종료**: Ctrl+C → 잠금 해제(`releaseLock`) 후 프로세스 종료.

---

## 3. 모듈별 구동 로직

### 3.1 쇼핑(유료) — check-batch-keywords.ts

- **입력**: `sellermate_keywords_navershopping`에서 `last_check_date` 오래된 순으로 조회.
- **처리**: `ParallelRankChecker`로 네이버 쇼핑 검색 → 순위 확인 (브라우저 병렬, BATCH_SIZE=1이면 1건).
- **저장**: `saveRankToSlotNaver` → `sellermate_slot_naver` 업데이트 + `sellermate_slot_rank_naver_history` INSERT.
- **기타**: 시작 전 `rotateIP`(rank-check 쪽), 연속 차단 시 IP 로테이션, `assigned_to`로 PC 락.

### 3.2 쇼핑트레픽(유료) — shopping-traffic/unified-runner.ts

- **입력**: `sellermate_traffic_navershopping`에서 작업 가져오기 (id 내림차순).
- **처리**: Patchright 브라우저 + 모바일 스텔스, 네이버 쇼핑 트래픽 실행. 캡차 시 `ReceiptCaptchaSolverPRB` 등 처리.
- **저장**: 성공 시 `success_count` +1, 실패 시 `fail_count` +1 (`sellermate_slot_naver` 등).
- **기타**: TEMP는 D:\temp 또는 C:\turafic\temp, `getCurrentIP`(ipRotation) 로그/허트비트.

### 3.3 쿠팡(유료/무료) — coupang-rank-processor.ts

- **유료**: `sellermate_keywords`에서 `slot_type` IN ('쿠팡','쿠팡VIP','쿠팡APP','쿠팡순위체크'), `assigned_to` null인 1건을 원자적으로 할당(update assigned_to=PC_ID).
- **무료**: `--free-only` 시 `free_coupang_id` not null인 키워드 처리.
- **처리**: Patchright으로 쿠팡 검색 → 상품 순위·가격 등 추출.
- **저장**: 유료는 slot/히스토리 업데이트, 무료는 무료 전용 히스토리. 처리 후 해당 키워드 행 삭제 또는 assigned_to 해제.

### 3.4 플레이스(유료/무료) — check-place-batch.ts

- **유료**(`--slot-only`): `sellermate_keywords_place`에서 `slot_id` 있는 항목, `assigned_to` null인 것 할당.
- **무료**(`--free-only`): `free_place_id` 있는 항목만 처리.
- **처리**:
  - 유료: (선택) 상위 20개 하루 1회 `fetchTop20List` → `saveTop20ToHistory`; 매번 `checkPlaceRank`(타겟 순위) → 상세 진입 후 `saveRankToSlotPlace`.
  - 무료: `checkPlaceRankRankOnly`(순위만) → `saveFreePlaceRankToHistory`.
- **저장**: `sellermate_slot_rank_place_history` / `free_place_rank_history`, `sellermate_slot_place` 업데이트. 처리 후 `sellermate_keywords_place`에서 해당 행 삭제.
- **기타**: 검색 1건 완료 시 쿠키·캐시 제거 후 창 닫기. IP 로테이션(시작 전 + 데이터 끊김 시 복구 데몬).

### 3.5 쇼핑(무료) — check-free-navership-batch.ts

- **입력**: `sellermate_keywords_navershopping`에서 `free_navershopping_id` not null, `assigned_to` null인 항목 원자적 할당.
- **처리**: `ParallelRankChecker`로 순위만 체크.
- **저장**: `saveFreeNavershoppingRankToHistory` → `sellermate_free_navershopping_rank_history`. 처리 후 해당 키워드 행 삭제.

---

## 4. IP 로테이션 및 복구 (ipRotation.ts / place-check)

- **사용처**: 플레이스 배치(`check-place-batch.ts`), 쇼핑 배치(`check-batch-keywords.ts`), 쇼핑트레픽(`getCurrentIP`).
- **방식**: 환경변수 `IP_ROTATION_METHOD` — `adb` | `adapter` | `auto` | `disabled`.
- **시점**:
  - 플레이스: 배치 시작 전 1회 `rotateIP`; 동일 키워드+URL 재작업 시 데이터 껐다 켜기.
  - RecoveryDaemon: 5초 간격으로 모바일 데이터 자동 복구(`adb shell svc data enable` 등).
- **결과**: `IPRotationResult` (success, oldIP, newIP, method).

---

## 5. 환경 요구사항

- **Node.js**: >= 18.
- **.env**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 필수. (쿠팡은 `NEXT_PUBLIC_SUPABASE_URL` 또는 `SUPABASE_URL` 사용.)
- **선택**: `.env.local`(IP_ROTATION_METHOD 등), `PC_ID`/`COMPUTERNAME`/`HOSTNAME`(다중 PC 시 할당 락용).

---

## 6. 요약 흐름도

```
start.bat / npm start
       ↓
run-unified.ts (락 획득)
       ↓
┌──────────────────────────────────────────────────────────────────┐
│  while (true) {                                                   │
│    runShoppingOnce();        // 쇼핑 유료 1건                     │
│    runShoppingTrafficOnce(); // 쇼핑트레픽 유료 1건               │
│    runCoupangOnce();         // 쿠팡 유료 1건                     │
│    runPlaceSlotOnce();       // 플레이스 유료 1건                 │
│    runPlaceFreeOnce();       // 플레이스 무료 1건                  │
│    runShopFreeOnce();        // 쇼핑 무료 1건                     │
│    runCoupangFreeOnce();     // 쿠팡 무료 1건                     │
│    delay(3000);              // 다음 라운드까지 3초                │
│  }                                                               │
└──────────────────────────────────────────────────────────────────┘
       ↓
Ctrl+C → releaseLock() → exit
```

각 단계는 **Supabase에서 1건 할당 → 브라우저/패치라이트로 순위·트래픽 처리 → 히스토리/슬롯 테이블 저장 → (필요 시) 키워드 행 삭제** 구조로 동일하게 동작합니다.
