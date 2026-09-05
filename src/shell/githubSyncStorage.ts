// GitHub 동기화 설정(v30) — owner/repo/path와 개인 액세스 토큰을 이 기기의
// localStorage에만 둔다. core/backup.ts의 내보내기 봉투(IndexedDB 스냅샷)와는
// 철저히 분리한다: 저기에 이 값이 섞여 나가면 "백업 파일 공유"가 곧 "토큰 유출"이
// 된다. reminderStorage.ts와 같은 이유로 기기-로컬 UI 상태로 취급한다.

const CONFIG_KEY = 'la.githubSync.config'
const LAST_SYNCED_KEY = 'la.githubSync.lastSyncedAt'

export interface GithubSyncConfig {
  owner: string
  repo: string
  path: string
  token: string
}

function isSyncConfig(v: unknown): v is GithubSyncConfig {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as GithubSyncConfig).owner === 'string' &&
    typeof (v as GithubSyncConfig).repo === 'string' &&
    typeof (v as GithubSyncConfig).path === 'string' &&
    typeof (v as GithubSyncConfig).token === 'string'
  )
}

export function getSyncConfig(): GithubSyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isSyncConfig(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function setSyncConfig(config: GithubSyncConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch {
    // 프라이빗 모드 등 접근 차단 — 조용히 무시(reminderStorage.ts와 같은 이유).
  }
}

export function clearSyncConfig(): void {
  try {
    localStorage.removeItem(CONFIG_KEY)
  } catch {
    // 위와 같은 이유로 무시.
  }
}

export function getLastSyncedAt(): string | null {
  try {
    return localStorage.getItem(LAST_SYNCED_KEY)
  } catch {
    return null
  }
}

export function setLastSyncedAt(iso: string): void {
  try {
    localStorage.setItem(LAST_SYNCED_KEY, iso)
  } catch {
    // 위와 같은 이유로 무시.
  }
}
