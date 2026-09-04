// "전체 카드" 패널 — 검색·필터 바 + 목록. 필터 상태는 이 컴포넌트가 들고,
// 판정은 deckFilter.ts의 순수 술어에 위임한다. 편집은 CardsView의 ItemForm이
// 담당하므로 onEdit 콜백으로 올려보낸다.

import { useMemo, useState } from 'react'
import type { ItemType } from '../core/types'
import { useAtlas } from '../core/atlas'
import { formatDue } from '../core/format'
import { bandOf, bandLabel, predictedRecall } from '../scheduler/selection'
import { errorTagLabel } from '../activities/ErrorTagPicker'
import { TYPE_LABEL, itemSummary } from './itemDisplay'
import {
  emptyFilter,
  isFilterActive,
  matchesDeckFilter,
  type DeckFilter,
  type DeckStatus,
} from './deckFilter'

const TYPES: ItemType[] = ['flashcard', 'cloze', 'mcq', 'code']
const STATUS_LABEL: Record<DeckStatus, string> = {
  all: '모든 상태',
  due: '만기',
  new: '신규',
  scheduled: '예정',
  leech: '격리',
}
const BAND_OPTIONS = ['all', 'desirable', 'too-hard', 'too-easy', 'unknown'] as const

interface Props {
  editingId: string | null
  onEdit: (id: string) => void
}

export function Deck({ editingId, onEdit }: Props) {
  const { items, cardStates, eloState, kcById, kcs, latestByItem, leechItemIds, now, deleteItem } =
    useAtlas()
  const [filter, setFilter] = useState<DeckFilter>(emptyFilter)

  const filtered = useMemo(
    () =>
      items.filter((item) =>
        matchesDeckFilter(item, filter, { cardStates, eloState, kcById, leechItemIds, now }),
      ),
    [items, filter, cardStates, eloState, kcById, leechItemIds, now],
  )
  const active = isFilterActive(filter)

  function toggleType(t: ItemType) {
    setFilter((f) => {
      const types = new Set(f.types)
      if (types.has(t)) types.delete(t)
      else types.add(t)
      return { ...f, types }
    })
  }

  const kcValue = filter.kcId === 'all' ? 'all' : filter.kcId === null ? '__none' : filter.kcId

  return (
    <section className="panel deck">
      <h2>전체 카드</h2>

      <div className="deck-filter">
        <input
          type="search"
          className="deck-search"
          placeholder="내용·분류 검색…"
          value={filter.query}
          onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
        />
        <div className="deck-filter-chips">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={filter.types.has(t) ? 'chip active' : 'chip'}
              onClick={() => toggleType(t)}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <select
          value={filter.status}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as DeckStatus }))}
        >
          {(Object.keys(STATUS_LABEL) as DeckStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          value={kcValue}
          onChange={(e) => {
            const v = e.target.value
            setFilter((f) => ({ ...f, kcId: v === 'all' ? 'all' : v === '__none' ? null : v }))
          }}
        >
          <option value="all">모든 분류</option>
          <option value="__none">분류 없음</option>
          {kcs.map((kc) => (
            <option key={kc.id} value={kc.id}>
              {kc.name}
            </option>
          ))}
        </select>
        <select
          value={filter.band}
          onChange={(e) =>
            setFilter((f) => ({ ...f, band: e.target.value as DeckFilter['band'] }))
          }
        >
          {BAND_OPTIONS.map((b) => (
            <option key={b} value={b}>
              {b === 'all' ? '모든 난이도' : bandLabel(b)}
            </option>
          ))}
        </select>
        {active && (
          <button type="button" className="reveal deck-filter-reset" onClick={() => setFilter(emptyFilter())}>
            초기화
          </button>
        )}
      </div>

      <p className="deck-count muted">
        {filtered.length}개{active && ` / 전체 ${items.length}개`}
      </p>

      {filtered.length === 0 ? (
        <p className="muted">{active ? '조건에 맞는 카드가 없습니다.' : '아직 카드가 없습니다.'}</p>
      ) : (
        <ul>
          {filtered.map((item) => {
            const state = cardStates.get(item.id)
            const kc = item.kcId ? kcById.get(item.kcId) : undefined
            const latest = latestByItem.get(item.id)
            const recall = state && state.state !== 'new' ? predictedRecall(item, eloState) : null
            return (
              <li key={item.id} className={item.id === editingId ? 'editing' : undefined}>
                <span className="deck-type muted">{TYPE_LABEL[item.type]}</span>
                <span className="deck-front">{itemSummary(item)}</span>
                {kc && <span className="kc-badge kc-badge-sm">{kc.name}</span>}
                {latest?.errorTag && (
                  <span className="error-tag-badge">{errorTagLabel(latest.errorTag)}</span>
                )}
                {recall !== null && (
                  <span
                    className={`band-badge band-${bandOf(recall)}`}
                    title={`예측 회상률 — ${bandLabel(bandOf(recall))}`}
                  >
                    {Math.round(recall * 100)}%
                  </span>
                )}
                {leechItemIds.has(item.id) && <span className="leech-badge">격리</span>}
                <span className="deck-due muted">{state ? formatDue(state.due, now) : ''}</span>
                <button className="edit" onClick={() => onEdit(item.id)}>
                  편집
                </button>
                <button className="delete" onClick={() => deleteItem(item.id)}>
                  삭제
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
