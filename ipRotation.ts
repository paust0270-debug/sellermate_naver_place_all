/**
 * IP Rotation Module (place-check에서 ../../ipRotation 로 사용)
 * ADB 우선, 네트워크 어댑터 fallback
 */
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const ADB_DATA_OFF_DELAY = 5000;
const ADB_DATA_ON_DELAY = 5000;
const ADAPTER_OFF_DELAY = 3000;
const ADAPTER_ON_DELAY = 5000;
const IP_CHECK_RETRY = 3;
const IP_CHECK_RETRY_DELAY = 2000;
const RECOVERY_DAEMON_INTERVAL = 5000;
const NO_RESPONSE_RECOVERY_INTERVAL = 10000;
const NO_RESPONSE_ADB_TIMEOUT = 15000;
const NO_RESPONSE_RECOVERY_PC_THRESHOLD = 3;

let recoveryDaemonRunning = false;
let recoveryDaemonInterval: NodeJS.Timeout | null = null;
let noResponseRecoveryInterval: NodeJS.Timeout | null = null;
let noResponseRecoveryFailCount = 0;
let dataRecoveryPCMode = false;
let periodicRotationInterval: NodeJS.Timeout | null = null;

export interface IPRotationResult {
  success: boolean;
  oldIP: string;
  newIP: string;
  method?: "adb" | "adapter" | "skipped";
  error?: string;
}

type RotationMethod = "adb" | "adapter" | "auto" | "disabled";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(msg: string): void {
  console.log(`[IPRotation] ${msg}`);
}

function logError(msg: string): void {
  console.error(`[IPRotation] [ERROR] ${msg}`);
}

function getRotationMethod(): RotationMethod {
  const method = (process.env.IP_ROTATION_METHOD || "auto").toLowerCase();
  if (["adb", "adapter", "auto", "disabled"].includes(method)) return method as RotationMethod;
  return "auto";
}

export async function getCurrentIP(): Promise<string> {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = (await response.json()) as { ip: string };
    return data.ip;
  } catch {
    try {
      const response = await fetch("https://ifconfig.me/ip");
      return (await response.text()).trim();
    } catch {
      throw new Error("IP 확인 실패: 네트워크 연결 확인 필요");
    }
  }
}

export function startRecoveryDaemon(): void {
  if (recoveryDaemonRunning) return;
  if (getRotationMethod() === "disabled") return;
  recoveryDaemonRunning = true;
  log("[RecoveryDaemon] 시작 - 5초마다 모바일 데이터 자동 복구");
  recoveryDaemonInterval = setInterval(async () => {
    if (dataRecoveryPCMode) return;
    try {
      await execAsync("adb shell svc data enable", { encoding: "utf8", timeout: 5000, windowsHide: true });
    } catch {}
  }, RECOVERY_DAEMON_INTERVAL);
  startNoResponseRecoveryDaemon();
}

function startNoResponseRecoveryDaemon(): void {
  if (noResponseRecoveryInterval) return;
  noResponseRecoveryFailCount = 0;
  noResponseRecoveryInterval = setInterval(async () => {
    if (noResponseRecoveryFailCount >= NO_RESPONSE_RECOVERY_PC_THRESHOLD) return;
    try {
      await execAsync("adb shell svc data enable", { encoding: "utf8", timeout: NO_RESPONSE_ADB_TIMEOUT, windowsHide: true });
      noResponseRecoveryFailCount = 0;
    } catch (e: unknown) {
      noResponseRecoveryFailCount += 1;
      if (noResponseRecoveryFailCount >= NO_RESPONSE_RECOVERY_PC_THRESHOLD) {
        dataRecoveryPCMode = true;
        if (noResponseRecoveryInterval) {
          clearInterval(noResponseRecoveryInterval);
          noResponseRecoveryInterval = null;
        }
      }
    }
  }, NO_RESPONSE_RECOVERY_INTERVAL);
}

function stopNoResponseRecoveryDaemon(): void {
  if (noResponseRecoveryInterval) {
    clearInterval(noResponseRecoveryInterval);
    noResponseRecoveryInterval = null;
    noResponseRecoveryFailCount = 0;
    dataRecoveryPCMode = false;
  }
}

export function stopRecoveryDaemon(): void {
  stopNoResponseRecoveryDaemon();
  if (recoveryDaemonInterval) {
    clearInterval(recoveryDaemonInterval);
    recoveryDaemonInterval = null;
    recoveryDaemonRunning = false;
  }
}

export function isRecoveryDaemonRunning(): boolean {
  return recoveryDaemonRunning;
}

export function startPeriodicRotationDaemon(intervalMinutes: number = 10): void {
  if (periodicRotationInterval) return;
  if (getRotationMethod() === "disabled") return;
  const intervalMs = intervalMinutes * 60 * 1000;
  periodicRotationInterval = setInterval(async () => {
    try {
      const result = await rotateIP();
      if (result.success && result.oldIP !== result.newIP) {
        console.log(`📡 [주기] IP 변경 완료: ${result.oldIP} -> ${result.newIP}`);
      }
    } catch (err: unknown) {
      logError(`[PeriodicRotation] 실패: ${(err as Error).message}`);
    }
  }, intervalMs);
}

export function stopPeriodicRotationDaemon(): void {
  if (periodicRotationInterval) {
    clearInterval(periodicRotationInterval);
    periodicRotationInterval = null;
  }
}

async function checkAdbDeviceStatus(): Promise<"device" | "unauthorized" | null> {
  try {
    const { stdout } = await execAsync("adb devices", { encoding: "utf8", timeout: 10000, windowsHide: true });
    const lines = stdout.trim().split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        if (parts[1] === "device") return "device";
        if (parts[1] === "unauthorized") return "unauthorized";
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function setMobileData(enable: boolean): Promise<boolean> {
  try {
    const cmd = enable ? "adb shell svc data enable" : "adb shell svc data disable";
    await execAsync(cmd, { encoding: "utf8", timeout: 10000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function rotateIPWithAdb(oldIP: string): Promise<IPRotationResult> {
  if (!(await setMobileData(false))) return { success: false, oldIP, newIP: "", method: "adb", error: "ADB control failed" };
  await sleep(ADB_DATA_OFF_DELAY);
  if (!recoveryDaemonRunning && !(await setMobileData(true))) {
    return { success: false, oldIP, newIP: "", method: "adb", error: "ADB control failed" };
  }
  await sleep(ADB_DATA_ON_DELAY);
  let newIP = "";
  for (let i = 0; i < IP_CHECK_RETRY; i++) {
    try {
      newIP = await getCurrentIP();
      break;
    } catch {
      await sleep(IP_CHECK_RETRY_DELAY);
    }
  }
  if (!newIP) return { success: false, oldIP, newIP: "", method: "adb", error: "새 IP 확인 실패" };
  if (oldIP === newIP) return { success: false, oldIP, newIP, method: "adb", error: "IP NOT CHANGED" };
  return { success: true, oldIP, newIP, method: "adb" };
}

export async function getTetheringAdapter(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and ($_.InterfaceDescription -like '*USB*' -or $_.InterfaceDescription -like '*Android*') } | Select-Object -First 1 -ExpandProperty ifIndex"`,
      { encoding: "utf8", windowsHide: true, timeout: 15000 }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function disableAdapter(ifIndex: string): Promise<boolean> {
  try {
    await execAsync(
      `powershell -NoProfile -Command "Get-NetAdapter -InterfaceIndex ${ifIndex} | Disable-NetAdapter -Confirm:$false"`,
      { encoding: "utf8", windowsHide: true, timeout: 15000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function enableAdapter(ifIndex: string): Promise<boolean> {
  try {
    await execAsync(
      `powershell -NoProfile -Command "Get-NetAdapter -InterfaceIndex ${ifIndex} | Enable-NetAdapter -Confirm:$false"`,
      { encoding: "utf8", windowsHide: true, timeout: 15000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function rotateIPWithAdapter(oldIP: string, adapterIndex?: string): Promise<IPRotationResult> {
  const adapter = adapterIndex || (await getTetheringAdapter());
  if (!adapter) return { success: false, oldIP, newIP: "", method: "adapter", error: "테더링 어댑터 없음" };
  if (!(await disableAdapter(adapter))) return { success: false, oldIP, newIP: "", method: "adapter", error: "어댑터 비활성화 실패" };
  await sleep(ADAPTER_OFF_DELAY);
  if (!(await enableAdapter(adapter))) return { success: false, oldIP, newIP: "", method: "adapter", error: "어댑터 활성화 실패" };
  await sleep(ADAPTER_ON_DELAY);
  let newIP = "";
  for (let i = 0; i < IP_CHECK_RETRY; i++) {
    try {
      newIP = await getCurrentIP();
      break;
    } catch {
      await sleep(IP_CHECK_RETRY_DELAY);
    }
  }
  if (!newIP) return { success: false, oldIP, newIP: "", method: "adapter", error: "새 IP 확인 실패" };
  if (oldIP === newIP) return { success: false, oldIP, newIP, method: "adapter", error: "IP NOT CHANGED" };
  return { success: true, oldIP, newIP, method: "adapter" };
}

export async function rotateIP(adapterIndex?: string): Promise<IPRotationResult> {
  const method = getRotationMethod();
  if (method === "disabled") {
    const currentIP = await getCurrentIP().catch(() => "");
    return { success: true, oldIP: currentIP, newIP: currentIP, method: "skipped" };
  }
  let oldIP: string;
  try {
    oldIP = await getCurrentIP();
  } catch (error: unknown) {
    return { success: false, oldIP: "", newIP: "", error: `현재 IP 확인 실패: ${(error as Error).message}` };
  }
  if (method === "auto" || method === "adb") {
    const adbStatus = await checkAdbDeviceStatus();
    if (adbStatus === "device") {
      const result = await rotateIPWithAdb(oldIP);
      if (result.success) return result;
      if (method === "auto") {
        /* fallback to adapter */
      } else return result;
    }
    if (adbStatus === "unauthorized" && method === "adb") {
      return { success: true, oldIP, newIP: oldIP, method: "skipped", error: "ADB 권한 미허용" };
    }
    if (adbStatus === null && method === "adb") {
      return { success: true, oldIP, newIP: oldIP, method: "skipped", error: "ADB 기기 없음" };
    }
  }
  if (method === "auto" || method === "adapter") {
    const result = await rotateIPWithAdapter(oldIP, adapterIndex);
    if (result.success) return result;
    if (method === "auto") {
      return { success: true, oldIP, newIP: oldIP, method: "skipped", error: "모든 방식 실패" };
    }
    return result;
  }
  return { success: false, oldIP, newIP: "", error: "알 수 없는 오류" };
}
