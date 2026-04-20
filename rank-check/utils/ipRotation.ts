/**
 * IP Rotation Module (ADB 방식)
 *
 * USB 연결된 휴대폰의 모바일 데이터를 ADB로 껐다 켜서 IP 변경
 * - ADB 미연결 또는 권한 없으면 자동으로 패스
 * - 한글 인코딩 문제 해결 (영어 출력 강제)
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ============ 설정 ============
const DATA_OFF_DELAY = 5000;  // 5초
const DATA_ON_DELAY = 5000;   // 5초
const IP_CHECK_RETRY = 3;
const IP_CHECK_RETRY_DELAY = 2000;

// ============ ADB 실행 (인코딩 문제 해결) ============
async function execAdb(command: string): Promise<string> {
  const { stdout, stderr } = await execAsync(
    `adb ${command}`,
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, LANG: 'en_US.UTF-8' }  // 영어 출력 강제
    }
  );
  if (stderr && !stderr.includes('daemon')) {
    console.log(`[ADB] stderr: ${stderr}`);
  }
  return stdout.trim();
}

// ============ IP 확인 ============
export async function getCurrentIP(): Promise<string> {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json() as { ip: string };
    return data.ip;
  } catch (error) {
    // 백업 API
    try {
      const response = await fetch("https://ifconfig.me/ip");
      return (await response.text()).trim();
    } catch {
      throw new Error("IP 확인 실패: 네트워크 연결 확인 필요");
    }
  }
}

// ============ ADB 연결 확인 ============
export async function checkAdbConnection(): Promise<boolean> {
  try {
    const result = await execAdb('devices');
    const lines = result.split('\n').filter(l => l.includes('\tdevice'));
    if (lines.length === 0) {
      console.log('[IPRotation] ADB 연결된 기기 없음');
      return false;
    }
    console.log(`[IPRotation] ADB 기기 연결됨: ${lines.length}개`);
    return true;
  } catch (error: any) {
    console.log(`[IPRotation] ADB 확인 실패: ${error.message}`);
    return false;
  }
}

// ============ ADB 권한 확인 ============
export async function checkAdbPermission(): Promise<boolean> {
  try {
    // 데이터 상태 확인 명령으로 권한 테스트
    await execAdb('shell svc data');
    return true;
  } catch (error: any) {
    if (error.message.includes('Permission denied') ||
        error.message.includes('not allowed') ||
        error.message.includes('error')) {
      console.log('[IPRotation] ADB 권한 없음 - IP 로테이션 비활성화');
      return false;
    }
    // 다른 에러는 권한 문제가 아닐 수 있음
    return true;
  }
}

// ============ 모바일 데이터 제어 ============
export async function disableMobileData(): Promise<void> {
  console.log('[IPRotation] 모바일 데이터 OFF...');
  await execAdb('shell svc data disable');
}

export async function enableMobileData(): Promise<void> {
  console.log('[IPRotation] 모바일 데이터 ON...');
  await execAdb('shell svc data enable');
}

// ============ IP 로테이션 결과 인터페이스 ============
export interface IPRotationResult {
  success: boolean;
  oldIP: string;
  newIP: string;
  error?: string;
  skipped?: boolean;  // ADB 미연결/권한 없어서 스킵됨
}

// ============ IP 로테이션 (ADB 방식) ============
export async function rotateIP(): Promise<IPRotationResult> {
  console.log('[IPRotation] ========== IP 로테이션 시작 ==========');

  // 1. ADB 연결 확인
  const connected = await checkAdbConnection();
  if (!connected) {
    console.log('[IPRotation] ADB 미연결 - IP 로테이션 패스');
    return {
      success: false,
      oldIP: "",
      newIP: "",
      error: "ADB 연결된 기기 없음",
      skipped: true,
    };
  }

  // 2. ADB 권한 확인
  const hasPermission = await checkAdbPermission();
  if (!hasPermission) {
    console.log('[IPRotation] ADB 권한 없음 - IP 로테이션 패스');
    return {
      success: false,
      oldIP: "",
      newIP: "",
      error: "ADB 권한 없음 (USB 디버깅 권한 필요)",
      skipped: true,
    };
  }

  // 3. 현재 IP 확인
  let oldIP: string;
  try {
    oldIP = await getCurrentIP();
    console.log(`[IPRotation] 현재 IP: ${oldIP}`);
  } catch (error: any) {
    return {
      success: false,
      oldIP: "",
      newIP: "",
      error: `현재 IP 확인 실패: ${error.message}`,
    };
  }

  // 4. 모바일 데이터 OFF
  try {
    await disableMobileData();
    console.log(`[IPRotation] ${DATA_OFF_DELAY / 1000}초 대기...`);
    await sleep(DATA_OFF_DELAY);
  } catch (error: any) {
    return {
      success: false,
      oldIP,
      newIP: "",
      error: `데이터 OFF 실패: ${error.message}`,
    };
  }

  // 5. 모바일 데이터 ON
  try {
    await enableMobileData();
    console.log(`[IPRotation] ${DATA_ON_DELAY / 1000}초 대기 (재연결)...`);
    await sleep(DATA_ON_DELAY);
  } catch (error: any) {
    return {
      success: false,
      oldIP,
      newIP: "",
      error: `데이터 ON 실패: ${error.message}`,
    };
  }

  // 6. 새 IP 확인 (재시도 포함)
  let newIP = "";
  for (let i = 0; i < IP_CHECK_RETRY; i++) {
    try {
      newIP = await getCurrentIP();
      break;
    } catch {
      console.log(`[IPRotation] IP 확인 재시도 ${i + 1}/${IP_CHECK_RETRY}...`);
      await sleep(IP_CHECK_RETRY_DELAY);
    }
  }

  if (!newIP) {
    return {
      success: false,
      oldIP,
      newIP: "",
      error: "새 IP 확인 실패: 네트워크 재연결 실패",
    };
  }

  // 7. IP 변경 확인
  if (oldIP === newIP) {
    console.log(`[IPRotation] 경고: IP가 변경되지 않음 (${oldIP})`);
    return {
      success: false,
      oldIP,
      newIP,
      error: "IP가 변경되지 않음",
    };
  }

  console.log(`[IPRotation] IP 변경 성공: ${oldIP} -> ${newIP}`);
  console.log('[IPRotation] ========== IP 로테이션 완료 ==========');
  return {
    success: true,
    oldIP,
    newIP,
  };
}

// ============ 유틸 ============
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
