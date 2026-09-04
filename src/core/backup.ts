// v5 데이터 백업 — 내보내기/가져오기의 순수 부분(직렬화·검증). IndexedDB 접근은
// core/db.ts(exportAll/importAll)가 하고, 여기서는 그 스냅샷을 파일용 봉투에
// 담거나, 사용자가 고른 파일이 정말 이 앱의 백업인지 확인만 한다.
//
// 왜 검증이 필요한가: 가져오기는 IndexedDB에 그대로 put 한다. 형태가 깨진
// 레코드가 들어가면 이후 파생 상태 계산(fsrs/elo/calibration)이 조용히 어긋난다
// — 로그가 유일한 진실의 원천인 구조에서 오염된 로그는 되돌리기 어렵다.

import { DB_VERSION, type DbSnapshot } from './db'
import type {
  ErrorTag,
  Grade,
  Interaction,
  Item,
  KnowledgeComponent,
  SchedulerSettings,
} from './types'

export const BACKUP_FORMAT = 'learning-atlas-backup'
export const BACKUP_VERSION = 1

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  /** 내보낸 시각(ISO-8601). */
  exportedAt: string
  /** 내보낼 당시의 IndexedDB 스키마 버전(db.ts DB_VERSION). */
  dbVersion: number
  data: DbSnapshot
}

export interface BackupSummary {
  items: number
  interactions: number
  kcs: number
  hasSettings: boolean
  exportedAt: string
}

export type ParseResult =
  | { ok: true; snapshot: DbSnapshot; summary: BackupSummary }
  | { ok: false; error: string }

export function serializeBackup(snapshot: DbSnapshot): string {
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    dbVersion: DB_VERSION,
    data: snapshot,
  }
  return JSON.stringify(file, null, 2)
}

export function backupFilename(now: Date = new Date()): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `learning-atlas-backup-${d}.json`
}

// ---- 검증 ----

const GRADES: Grade[] = ['again', 'hard', 'good', 'easy']
const ERROR_TAGS: ErrorTag[] = ['concept', 'procedure', 'carelessness', 'time']

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isKnowledgeComponent(v: unknown): v is KnowledgeComponent {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.createdAt === 'string' &&
    Array.isArray(v.prereqIds) &&
    v.prereqIds.every((p) => typeof p === 'string') &&
    (v.requestRetention === undefined ||
      (typeof v.requestRetention === 'number' &&
        v.requestRetention > 0 &&
        v.requestRetention < 1))
  )
}

function isItem(v: unknown): v is Item {
  if (!isObject(v)) return false
  if (typeof v.id !== 'string' || typeof v.createdAt !== 'string') return false
  if (!(v.kcId === null || typeof v.kcId === 'string')) return false
  switch (v.type) {
    case 'flashcard':
      return typeof v.front === 'string' && typeof v.back === 'string'
    case 'cloze':
      return typeof v.text === 'string'
    case 'mcq':
      return (
        typeof v.prompt === 'string' &&
        Array.isArray(v.options) &&
        v.options.length === 4 &&
        v.options.every((o) => typeof o === 'string') &&
        typeof v.correctIndex === 'number' &&
        v.correctIndex >= 0 &&
        v.correctIndex <= 3
      )
    case 'code':
      return (
        typeof v.prompt === 'string' &&
        typeof v.starterCode === 'string' &&
        Array.isArray(v.tests) &&
        v.tests.every((t) => isObject(t) && Array.isArray((t as Record<string, unknown>).args))
      )
    case 'short':
      return (
        typeof v.prompt === 'string' &&
        Array.isArray(v.acceptedAnswers) &&
        v.acceptedAnswers.length > 0 &&
        v.acceptedAnswers.every((a) => typeof a === 'string')
      )
    default:
      return false
  }
}

function isInteraction(v: unknown): v is Interaction {
  if (!isObject(v)) return false
  return (
    typeof v.id === 'string' &&
    typeof v.itemId === 'string' &&
    typeof v.ts === 'string' &&
    typeof v.grade === 'string' &&
    (GRADES as string[]).includes(v.grade) &&
    (v.confidence === null || v.confidence === 1 || v.confidence === 2 || v.confidence === 3) &&
    (v.errorTag === null ||
      (typeof v.errorTag === 'string' && (ERROR_TAGS as string[]).includes(v.errorTag)))
  )
}

function isSchedulerSettings(v: unknown): v is SchedulerSettings {
  return (
    isObject(v) &&
    Array.isArray(v.w) &&
    v.w.every((n) => typeof n === 'number') &&
    typeof v.requestRetention === 'number' &&
    typeof v.fittedAt === 'string' &&
    typeof v.testLossBefore === 'number' &&
    typeof v.testLossAfter === 'number'
  )
}

export function parseBackup(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'JSON을 해석할 수 없습니다.' }
  }
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) {
    return { ok: false, error: 'learning-atlas 백업 파일이 아닙니다.' }
  }
  if (raw.version !== BACKUP_VERSION) {
    return { ok: false, error: `지원하지 않는 백업 버전입니다 (${String(raw.version)}).` }
  }
  // 더 낮은 버전의 백업은 받아들인다(레코드에 새 optional 필드가 없을 뿐이고,
  // 읽는 쪽에서 기본값으로 폴백한다). 더 높은 버전 = 이 앱이 모르는 스키마라 거부.
  if (typeof raw.dbVersion !== 'number' || raw.dbVersion > DB_VERSION) {
    return {
      ok: false,
      error: `더 새로운 스키마 버전(${String(raw.dbVersion)})에서 만든 백업입니다 — 현재는 v${DB_VERSION}.`,
    }
  }
  const data = raw.data
  if (
    !isObject(data) ||
    !Array.isArray(data.items) ||
    !Array.isArray(data.interactions) ||
    !Array.isArray(data.kcs)
  ) {
    return { ok: false, error: '백업 내용(data)의 형태가 올바르지 않습니다.' }
  }

  if (!data.items.every(isItem)) {
    return { ok: false, error: '카드(items) 중 형태가 깨진 레코드가 있습니다.' }
  }
  if (!data.interactions.every(isInteraction)) {
    return { ok: false, error: '채점 로그(interactions) 중 형태가 깨진 레코드가 있습니다.' }
  }
  if (!data.kcs.every(isKnowledgeComponent)) {
    return { ok: false, error: '지식 요소(kcs) 중 형태가 깨진 레코드가 있습니다.' }
  }
  const settings = data.schedulerSettings
  if (settings != null && !isSchedulerSettings(settings)) {
    return { ok: false, error: '스케줄러 설정(schedulerSettings)의 형태가 올바르지 않습니다.' }
  }

  // 참조 무결성: 로그가 가리키는 itemId가 카드 목록에 있어야 재생이 성립한다.
  const itemIds = new Set(data.items.map((it) => it.id))
  if (!data.interactions.every((it) => itemIds.has(it.itemId))) {
    return { ok: false, error: '채점 로그가 존재하지 않는 카드를 가리킵니다.' }
  }

  const snapshot: DbSnapshot = {
    items: data.items,
    interactions: data.interactions,
    kcs: data.kcs,
    schedulerSettings: (settings as SchedulerSettings | null | undefined) ?? null,
  }
  return {
    ok: true,
    snapshot,
    summary: {
      items: snapshot.items.length,
      interactions: snapshot.interactions.length,
      kcs: snapshot.kcs.length,
      hasSettings: snapshot.schedulerSettings !== null,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    },
  }
}
