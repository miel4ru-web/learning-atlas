// GitHub 저장소를 "데이터베이스"로 쓰는 기기 간 동기화(v30). 서버 없이 브라우저에서
// GitHub REST API(Contents)를 직접 불러 파일 하나를 읽고 쓴다. 진짜 실시간(웹소켓)은
// 아니고, 사용자가 "동기화"를 누른 순간에만 일어난다 — git이 원래 그런 도구다.
//
// 병합 규칙은 새로 만들지 않는다. core/backup.ts(직렬화·검증)와 core/db.ts의
// importAll('merge')를 그대로 쓴다: id가 겹치면 들어오는 쪽이 이기는 put이고,
// interactions는 crypto.randomUUID()라 기기가 달라도 id가 안 겹친다 — 그래서
// "원격을 받아 병합 → 합쳐진 전체를 다시 올림"이 실제로는 안전한 합집합이 된다.
// 이 파일은 그 앞뒤에 필요한 GitHub Contents API 호출과 base64/UTF-8 변환만 맡는다.

const API_BASE = 'https://api.github.com'

export interface SyncConfig {
  owner: string
  repo: string
  /** 저장소 안 파일 경로. 슬래시 포함 가능(예: data/sync.json). */
  path: string
  token: string
}

export interface RemoteFile {
  /** 다음 업데이트(PUT) 때 그대로 넘겨야 하는 blob sha. */
  sha: string
  text: string
}

/** btoa/atob는 라틴1 바이트 문자열만 다뤄, 그대로 쓰면 한글이 깨진다 —
 *  TextEncoder/Decoder로 UTF-8 바이트를 거쳐야 한다. 32KB씩 나눠 돌리는 건
 *  String.fromCharCode(...bytes)에 큰 배열을 한 번에 펼치면 콜스택이 넘칠 수
 *  있어서다. */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function base64ToUtf8(base64: string): string {
  const binary = atob(base64.replace(/\n/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** 경로 세그먼트별로만 인코딩한다 — path 전체를 encodeURIComponent하면 슬래시까지
 *  %2F로 바뀌어 하위 폴더를 못 가리키게 된다. */
function encodeGithubPath(path: string): string {
  return path
    .split('/')
    .filter((seg) => seg.length > 0)
    .map(encodeURIComponent)
    .join('/')
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** 실제 읽기/쓰기 전에 저장소 접근 가능 여부를 먼저 확인해 에러 메시지를 더
 *  분명하게 낸다(파일이 아직 없는 것과 저장소/토큰이 잘못된 것은 구분해야 한다). */
export async function checkRepoAccess(config: SyncConfig): Promise<void> {
  const res = await fetch(`${API_BASE}/repos/${config.owner}/${config.repo}`, {
    headers: authHeaders(config.token),
  })
  if (res.status === 401) throw new Error('토큰이 유효하지 않습니다.')
  if (res.status === 404) {
    throw new Error('저장소를 찾을 수 없거나 이 토큰에 접근 권한이 없습니다.')
  }
  if (!res.ok) throw new Error(`저장소 확인 실패 (GitHub 오류 ${res.status})`)
}

/** 파일이 아직 없으면(첫 동기화) null — 이건 에러가 아니다. */
export async function fetchRemoteFile(config: SyncConfig): Promise<RemoteFile | null> {
  const url = `${API_BASE}/repos/${config.owner}/${config.repo}/contents/${encodeGithubPath(config.path)}`
  const res = await fetch(url, { headers: authHeaders(config.token) })
  if (res.status === 404) return null
  if (res.status === 401) throw new Error('토큰이 유효하지 않습니다.')
  if (!res.ok) throw new Error(`파일을 불러오지 못했습니다 (GitHub 오류 ${res.status})`)
  const json = (await res.json()) as { type?: string; content?: string; sha?: string }
  if (json.type !== 'file' || typeof json.content !== 'string' || typeof json.sha !== 'string') {
    throw new Error('지정한 경로가 단일 파일이 아닙니다.')
  }
  return { sha: json.sha, text: base64ToUtf8(json.content) }
}

/** sha가 null이면 새 파일 생성, 있으면 그 sha를 가진 버전 위에 업데이트 —
 *  sha가 어긋나면(다른 기기가 그 사이 먼저 올림) GitHub가 409/422를 준다. */
export async function putRemoteFile(
  config: SyncConfig,
  text: string,
  sha: string | null,
  message: string,
): Promise<void> {
  const url = `${API_BASE}/repos/${config.owner}/${config.repo}/contents/${encodeGithubPath(config.path)}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...authHeaders(config.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: utf8ToBase64(text),
      ...(sha ? { sha } : {}),
    }),
  })
  if (res.status === 401) throw new Error('토큰이 유효하지 않습니다(쓰기 권한 포함인지 확인하세요).')
  if (res.status === 409 || res.status === 422) {
    throw new Error('다른 기기가 그 사이 먼저 올렸습니다 — 동기화를 다시 눌러주세요.')
  }
  if (!res.ok) throw new Error(`업로드 실패 (GitHub 오류 ${res.status})`)
}
