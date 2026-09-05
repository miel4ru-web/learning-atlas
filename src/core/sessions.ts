// 학습 세션 기록 위의 순수 계산(v27). 세션 자체는 저장하지만 "어디까지 했나"는
// 저장하지 않는다 — 그건 sessionId가 붙은 채점 로그에서 나온다. 진행 상황을 따로
// 들고 있으면 로그와 어긋날 수 있고, 이 앱은 그런 이중 기록을 피하는 쪽을 택해 왔다.

import type { Interaction, StudySession } from './types'

/** 이 세션에서 이미 채점된 아이템 id들. */
function gradedIn(sessionId: string, interactions: readonly Interaction[]): Set<string> {
  const done = new Set<string>()
  for (const i of interactions) {
    if (i.sessionId === sessionId) done.add(i.itemId)
  }
  return done
}

/**
 * 이어서 할 위치. 계획된 순서에서 아직 채점되지 않은 첫 카드의 인덱스이며,
 * 전부 끝났으면 plannedItemIds.length(=세션 완료 화면)를 돌려준다.
 */
export function resumeIndex(session: StudySession, interactions: readonly Interaction[]): number {
  const done = gradedIn(session.id, interactions)
  const next = session.plannedItemIds.findIndex((id) => !done.has(id))
  return next === -1 ? session.plannedItemIds.length : next
}

/** 아직 안 끝난 세션(가장 최근 것 하나). 없으면 null. */
export function openSession(sessions: readonly StudySession[]): StudySession | null {
  const open = sessions.filter((s) => s.endedAt === null)
  if (open.length === 0) return null
  return open.reduce((latest, s) => (s.startedAt > latest.startedAt ? s : latest))
}

export interface SessionSummary {
  id: string
  startedAt: string
  budgetMinutes: number
  planned: number
  /** 실제로 채점한 카드 수. */
  completed: number
  /** 첫 채점부터 마지막 채점까지 걸린 시간(분). 채점이 하나뿐이면 0. */
  elapsedMinutes: number
  finished: boolean
}

/**
 * 최근 세션 요약 — "20분을 달라 했는데 실제로 몇 장을 했나"를 본다(3.1 부하
 * 평준화 튜닝의 근거). 최신 세션부터 준다.
 */
export function summarizeSessions(
  sessions: readonly StudySession[],
  interactions: readonly Interaction[],
  limit = 7,
): SessionSummary[] {
  const byId = new Map<string, Interaction[]>()
  for (const i of interactions) {
    if (!i.sessionId) continue
    const list = byId.get(i.sessionId)
    if (list) list.push(i)
    else byId.set(i.sessionId, [i])
  }

  return [...sessions]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit)
    .map((session) => {
      const logs = byId.get(session.id) ?? []
      const times = logs.map((l) => new Date(l.ts).getTime()).sort((a, b) => a - b)
      const elapsedMs = times.length > 1 ? times[times.length - 1] - times[0] : 0
      return {
        id: session.id,
        startedAt: session.startedAt,
        budgetMinutes: session.budgetMinutes,
        planned: session.plannedItemIds.length,
        completed: new Set(logs.map((l) => l.itemId)).size,
        elapsedMinutes: Math.round(elapsedMs / 60000),
        finished: session.endedAt !== null,
      }
    })
}
