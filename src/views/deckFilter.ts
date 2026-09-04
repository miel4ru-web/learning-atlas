// "전체 카드" 목록의 검색·필터. 순수 술어 하나(matchesDeckFilter)로 두고 Deck이
// items.filter에 건다 — 파생 상태(카드 상태·Elo·leech)는 이미 AtlasProvider가
// 들고 있으므로 여기서 계산하지 않고 ctx로 받는다.

import type { CardState, EloState, Item, KnowledgeComponent } from '../core/types'
import { itemSummary } from './itemDisplay'
import { bandOf, predictedRecall, type DifficultyBand } from '../scheduler/selection'
import { isDue } from '../scheduler/fsrs'

export type DeckStatus = 'all' | 'due' | 'new' | 'scheduled' | 'leech'

export interface DeckFilter {
  query: string
  /** 빈 집합 = 모든 타입 */
  types: Set<Item['type']>
  /** 'all' = 전체, null = 분류 없음, 그 외 = 해당 KC id */
  kcId: 'all' | null | string
  status: DeckStatus
  band: DifficultyBand | 'all'
}

export function emptyFilter(): DeckFilter {
  return { query: '', types: new Set(), kcId: 'all', status: 'all', band: 'all' }
}

export function isFilterActive(f: DeckFilter): boolean {
  return (
    f.query.trim() !== '' ||
    f.types.size > 0 ||
    f.kcId !== 'all' ||
    f.status !== 'all' ||
    f.band !== 'all'
  )
}

export interface DeckFilterCtx {
  cardStates: ReadonlyMap<string, CardState>
  eloState: EloState
  kcById: ReadonlyMap<string, KnowledgeComponent>
  leechItemIds: ReadonlySet<string>
  now: Date
}

function matchesStatus(item: Item, status: DeckStatus, ctx: DeckFilterCtx): boolean {
  if (status === 'all') return true
  const isLeech = ctx.leechItemIds.has(item.id)
  const state = ctx.cardStates.get(item.id)
  if (status === 'leech') return isLeech
  if (status === 'new') return state?.state === 'new'
  if (isLeech || !state || state.state === 'new') return false
  return status === 'due' ? isDue(state, ctx.now) : !isDue(state, ctx.now) // 'scheduled' = 아직 만기 전
}

/** 카드 목록에 보여줄 예측 회상률. 아직 채점 안 된 신규 카드는 의미가 없어 null. */
export function cardRecall(item: Item, state: CardState | undefined, elo: EloState): number | null {
  return state && state.state !== 'new' ? predictedRecall(item, elo) : null
}

export function matchesDeckFilter(item: Item, f: DeckFilter, ctx: DeckFilterCtx): boolean {
  if (f.types.size > 0 && !f.types.has(item.type)) return false

  if (f.kcId !== 'all' && item.kcId !== f.kcId) return false

  const q = f.query.trim().toLowerCase()
  if (q) {
    const kcName = item.kcId ? (ctx.kcById.get(item.kcId)?.name ?? '') : ''
    if (!`${itemSummary(item)} ${kcName}`.toLowerCase().includes(q)) return false
  }

  if (!matchesStatus(item, f.status, ctx)) return false

  if (f.band !== 'all') {
    // 신규·미채점 카드도 KC가 있으면 밴드로 분류한다(predictedRecall이 형제 카드
    // θ로 값을 낸다) — 'unknown'은 순수히 "KC 미분류"만 뜻하게 남겨 kcId===null과
    // 뜻이 갈리지 않게 한다. 배지 표시용 cardRecall과는 별개(그쪽은 신규 카드를
    // 의도적으로 가린다).
    if (bandOf(predictedRecall(item, ctx.eloState)) !== f.band) return false
  }

  return true
}
