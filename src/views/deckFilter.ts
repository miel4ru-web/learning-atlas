// "전체 카드" 목록의 검색·필터. 순수 술어 하나(matchesDeckFilter)로 두고 Deck이
// items.filter에 건다 — 파생 상태(카드 상태·Elo·leech)는 이미 AtlasProvider가
// 들고 있으므로 여기서 계산하지 않고 ctx로 받는다.

import type { CardState, EloState, Item, KnowledgeComponent } from '../core/types'
import { itemSummary } from './itemDisplay'
import { bandOf, predictedRecall, type DifficultyBand } from '../scheduler/selection'

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
  const due = state.due.getTime() <= ctx.now.getTime()
  return status === 'due' ? due : !due // 'scheduled' = 아직 만기 전
}

export function matchesDeckFilter(item: Item, f: DeckFilter, ctx: DeckFilterCtx): boolean {
  if (f.types.size > 0 && !f.types.has(item.type)) return false

  if (f.kcId === null) {
    if (item.kcId !== null) return false
  } else if (f.kcId !== 'all' && item.kcId !== f.kcId) {
    return false
  }

  const q = f.query.trim().toLowerCase()
  if (q) {
    const kcName = item.kcId ? (ctx.kcById.get(item.kcId)?.name ?? '') : ''
    if (!`${itemSummary(item)} ${kcName}`.toLowerCase().includes(q)) return false
  }

  if (!matchesStatus(item, f.status, ctx)) return false

  if (f.band !== 'all') {
    const state = ctx.cardStates.get(item.id)
    const recall = state && state.state !== 'new' ? predictedRecall(item, ctx.eloState) : null
    if (bandOf(recall) !== f.band) return false
  }

  return true
}
