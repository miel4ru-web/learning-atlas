import { describe, expect, it } from 'vitest'
import { openSession, resumeIndex, summarizeSessions } from './sessions'
import { interaction } from '../test/factories'
import type { StudySession } from './types'

function session(o: Partial<StudySession> = {}): StudySession {
  return {
    id: 's1',
    startedAt: '2026-01-01T09:00:00.000Z',
    endedAt: null,
    budgetMinutes: 20,
    policyVersion: 'default',
    plannedItemIds: ['a', 'b', 'c'],
    pretestItemId: null,
    ...o,
  }
}

describe('resumeIndex', () => {
  it('아직 안 한 첫 카드를 가리킨다', () => {
    const logs = [interaction('a', 'good', 0, { sessionId: 's1' })]
    expect(resumeIndex(session(), logs)).toBe(1)
  })

  it('아무것도 안 했으면 0', () => {
    expect(resumeIndex(session(), [])).toBe(0)
  })

  it('전부 했으면 계획 길이(=완료 화면)', () => {
    const logs = ['a', 'b', 'c'].map((id, i) => interaction(id, 'good', i, { sessionId: 's1' }))
    expect(resumeIndex(session(), logs)).toBe(3)
  })

  it('다른 세션의 채점은 세지 않는다', () => {
    const logs = [interaction('a', 'good', 0, { sessionId: 'other' })]
    expect(resumeIndex(session(), logs)).toBe(0)
  })

  it('세션 밖 채점(sessionId 없는 구버전 로그)도 세지 않는다', () => {
    expect(resumeIndex(session(), [interaction('a', 'good', 0)])).toBe(0)
  })

  it('중간을 건너뛴 기록이 있어도 "안 한 첫 카드"를 가리킨다', () => {
    const logs = [interaction('b', 'good', 0, { sessionId: 's1' })]
    expect(resumeIndex(session(), logs)).toBe(0)
  })
})

describe('openSession', () => {
  it('안 끝난 세션이 없으면 null', () => {
    expect(openSession([session({ endedAt: '2026-01-01T09:30:00.000Z' })])).toBeNull()
  })

  it('안 끝난 세션 중 가장 최근 것', () => {
    const older = session({ id: 'old', startedAt: '2026-01-01T09:00:00.000Z' })
    const newer = session({ id: 'new', startedAt: '2026-01-02T09:00:00.000Z' })
    const done = session({ id: 'done', startedAt: '2026-01-03T09:00:00.000Z', endedAt: 'x' })
    expect(openSession([older, newer, done])?.id).toBe('new')
  })
})

describe('summarizeSessions', () => {
  it('예산과 실제 소화량을 나란히 준다', () => {
    const s = session({ budgetMinutes: 20, plannedItemIds: ['a', 'b', 'c', 'd'] })
    const logs = [
      interaction('a', 'good', 0, { sessionId: 's1' }),
      interaction('b', 'good', 0, { sessionId: 's1' }),
    ]
    const [summary] = summarizeSessions([s], logs)
    expect(summary).toMatchObject({ budgetMinutes: 20, planned: 4, completed: 2, finished: false })
  })

  it('같은 카드를 두 번 채점해도 한 장으로 센다', () => {
    const logs = [
      interaction('a', 'again', 0, { sessionId: 's1' }),
      interaction('a', 'good', 0, { sessionId: 's1' }),
    ]
    expect(summarizeSessions([session()], logs)[0].completed).toBe(1)
  })

  it('최신 세션부터, 개수 제한을 지킨다', () => {
    const sessions = [
      session({ id: 's1', startedAt: '2026-01-01T09:00:00.000Z' }),
      session({ id: 's2', startedAt: '2026-01-02T09:00:00.000Z' }),
      session({ id: 's3', startedAt: '2026-01-03T09:00:00.000Z' }),
    ]
    expect(summarizeSessions(sessions, [], 2).map((s) => s.id)).toEqual(['s3', 's2'])
  })

  it('첫 채점부터 마지막까지 걸린 시간을 분으로 준다', () => {
    const logs = [
      { ...interaction('a', 'good', 0, { sessionId: 's1' }), ts: '2026-01-01T09:00:00.000Z' },
      { ...interaction('b', 'good', 0, { sessionId: 's1' }), ts: '2026-01-01T09:12:00.000Z' },
    ]
    expect(summarizeSessions([session()], logs)[0].elapsedMinutes).toBe(12)
  })

  it('채점이 없거나 하나뿐이면 걸린 시간은 0', () => {
    expect(summarizeSessions([session()], [])[0].elapsedMinutes).toBe(0)
  })
})
