# 쇼핑 + 플레이스 통합 러너 (이 폴더만 사용)

**이 폴더 하나만 있으면 됩니다.** 다른 프로젝트 폴더(sellermate_naver_rank_1, sellermate_naver_place)는 필요 없습니다.

- 쇼핑 1건 처리 → 플레이스 1건 처리 → 반복
- 로직은 모두 이 폴더 안의 `rank-check/`, `place-check/`, `ipRotation.ts`에 포함되어 있습니다.

## 사용법

```bash
# 1. 의존성 설치 (최초 1회)
npm install

# 2. 환경 변수: 이 폴더에 .env 파일 생성 (Supabase 등)
#    SUPABASE_URL=...
#    SUPABASE_SERVICE_ROLE_KEY=...
#    (선택) IP_ROTATION_METHOD=adb|adapter|auto|disabled

# 3. 통합 실행 (쇼핑 1건 → 플레이스 1건 반복)
npm start
```

종료: `Ctrl+C`

## 동작 방식

1. 이 폴더 기준으로 `rank-check/batch/check-batch-keywords.ts`를 `--limit=1 --once` 로 실행 → 쇼핑 1건 처리 후 종료
2. 같은 폴더 기준으로 `place-check/batch/check-place-batch.ts`를 `--limit=1 --once` 로 실행 → 플레이스 1건 처리 후 종료
3. 3초 대기 후 1번부터 반복

`.env`는 **이 폴더**에 두면 됩니다.
