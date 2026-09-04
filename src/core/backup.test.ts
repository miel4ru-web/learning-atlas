import { describe, expect, it } from 'vitest'
import { serializeBackup, parseBackup, BACKUP_FORMAT } from './backup'
import { DB_VERSION, type DbSnapshot } from './db'
import { flashcard, mcq, shortAnswer, kc, interaction } from '../test/factories'

function snapshot(): DbSnapshot {
  const a = flashcard({ kcId: 'kc-1' })
  const b = mcq()
  const c = shortAnswer()
  return {
    items: [a, b, c],
    interactions: [interaction(a.id, 'good', 0), interaction(a.id, 'again', 1, { confidence: 3 })],
    kcs: [kc({ id: 'kc-1', requestRetention: 0.95 })],
    schedulerSettings: null,
    studyPrefs: null,
  }
}

describe('serialize / parse 왕복', () => {
  it('내보낸 뒤 다시 파싱하면 같은 스냅샷', () => {
    const snap = snapshot()
    const result = parseBackup(serializeBackup(snap))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot).toEqual(snap)
      expect(result.summary).toMatchObject({ items: 3, interactions: 2, kcs: 1, hasSettings: false })
    }
  })

  it('봉투에 format·version·dbVersion·exportedAt이 들어간다', () => {
    const file = JSON.parse(serializeBackup(snapshot()))
    expect(file.format).toBe(BACKUP_FORMAT)
    expect(file.version).toBe(1)
    expect(file.dbVersion).toBe(DB_VERSION)
    expect(typeof file.exportedAt).toBe('string')
  })
})

describe('parseBackup 거부 케이스', () => {
  const ok = () => JSON.parse(serializeBackup(snapshot()))

  it('JSON이 아니면', () => {
    expect(parseBackup('{not json')).toMatchObject({ ok: false })
  })
  it('format이 다르면', () => {
    const f = ok()
    f.format = 'anki'
    expect(parseBackup(JSON.stringify(f))).toMatchObject({ ok: false })
  })
  it('더 새로운 스키마 버전은 거부', () => {
    const f = ok()
    f.dbVersion = DB_VERSION + 1
    expect(parseBackup(JSON.stringify(f))).toMatchObject({ ok: false })
  })
  it('더 낮은 스키마 버전은 받아들인다(구버전 백업 복원)', () => {
    const f = ok()
    f.dbVersion = DB_VERSION - 1
    expect(parseBackup(JSON.stringify(f))).toMatchObject({ ok: true })
  })
  it('KC 목표 파지율이 0~1 밖이면 거부', () => {
    const f = ok()
    f.data.kcs[0].requestRetention = 1
    expect(parseBackup(JSON.stringify(f))).toMatchObject({ ok: false })
  })
  it('형태가 깨진 레코드가 있으면', () => {
    const f = ok()
    f.data.items[0] = { id: 'x', type: 'flashcard' } // front/back 없음
    expect(parseBackup(JSON.stringify(f))).toMatchObject({ ok: false })
  })
  it('단답형인데 acceptedAnswers가 비어 있으면', () => {
    const f = ok()
    f.data.items[2].acceptedAnswers = []
    expect(parseBackup(JSON.stringify(f))).toMatchObject({ ok: false })
  })
  it('studyPrefs(v18)가 있으면 왕복되고, 형태가 깨졌으면 거부', () => {
    const f = ok()
    f.data.studyPrefs = { dailyReviewCap: 25, vacationMode: false }
    const result = parseBackup(JSON.stringify(f))
    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.snapshot.studyPrefs).toEqual({ dailyReviewCap: 25, vacationMode: false })
      expect(result.summary.hasStudyPrefs).toBe(true)
    }

    const broken = ok()
    broken.data.studyPrefs = { dailyReviewCap: 'many', vacationMode: false }
    expect(parseBackup(JSON.stringify(broken))).toMatchObject({ ok: false })
  })
  it('로그가 존재하지 않는 카드를 가리키면(참조 무결성)', () => {
    const f = ok()
    f.data.interactions[0].itemId = 'ghost'
    expect(parseBackup(JSON.stringify(f))).toMatchObject({ ok: false })
  })
})
