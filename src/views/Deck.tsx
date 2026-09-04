// "전체 카드" 패널 — 검색·필터 바 + 목록. 필터 상태는 이 컴포넌트가 들고,
// 판정은 deckFilter.ts의 순수 술어에 위임한다. 편집은 CardsView의 ItemForm이
// 담당하므로 onEdit 콜백으로 올려보낸다.

import { useEffect, useMemo, useState } from 'react'
import type { ItemType } from '../core/types'
import { useAtlas } from '../core/atlas'
import { formatDue } from '../core/format'
import { bandOf, bandLabel } from '../scheduler/selection'
import { errorTagLabel } from '../activities/ErrorTagPicker'
import { TYPE_LABEL, itemSummary } from './itemDisplay'
import {
  cardRecall,
  emptyFilter,
  isFilterActive,
  matchesDeckFilter,
  type DeckFilter,
  type DeckStatus,
} from './deckFilter'

const TYPES = Object.keys(TYPE_LABEL) as ItemType[]
const STATUS_LABEL: Record<DeckStatus, string> = {
  all: '모든 상태',
  due: '만기',
  new: '신규',
  scheduled: '예정',
  leech: '격리',
}
const BAND_OPTIONS = ['all', 'desirable', 'too-hard', 'too-easy', 'unknown'] as const
/** "분류 없음"을 나타내는 select 값 — filter.kcId의 null과 구분해야 하는 DOM 값이라 별도 상수로 뺀다. */
const NONE_KC = '__none'

interface Props {
  editingId: string | null
  onEdit: (id: string) => void
}

export function Deck({ editingId, onEdit }: Props) {
  const { items, cardStates, eloState, kcById, kcs, latestByItem, leechItemIds, now, deleteItem } =
    useAtlas()
  const [filter, setFilter] = useState<DeckFilter>(emptyFilter)

  // 필터가 걸어둔 KC가 삭제되면(kcs에서 사라짐) 필터를 조용히 'all'로 되돌린다 —
  // 안 그러면 select는 빈 값으로 보이는데 필터는 죽은 id와 계속 비교해 카드가
  // 전부 사라진 것처럼 보인다.
  useEffect(() => {
    if (typeof filter.kcId === 'string' && !kcs.some((kc) => kc.id === filter.kcId)) {
      setFilter((f) => ({ ...f, kcId: 'all' }))
    }
  }, [kcs, filter.kcId])

  const filtered = useMemo(
    () =>
      items.filter((item) =>
        matchesDeckFilter(item, filter, { cardStates, eloState, kcById, leechItemIds, now }),
      ),
    [items, filter, cardStates, eloState, kcById, leechItemIds, now],
  )
  const active = isFilterActive(filter)

  // 목록에 보이는 배지용 예측 회상률 — 행마다 다시 계산하지 않고 한 번에 구해
  // 필터가 쓰는 것과 같은 상태로 유지한다.
  const recallByItem = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const item of filtered) map.set(item.id, cardRecall(item, cardStates.get(item.id), eloState))
    return map
  }, [filtered, cardStates, eloState])

  function toggleType(t: ItemType) {
    setFilter((f) => {
      const types = new Set(f.types)
      if (types.has(t)) types.delete(t)
      else types.add(t)
      return { ...f, types }
    })
  }

  const kcValue = filter.kcId === 'all' ? 'all' : filter.kcId === null ? NONE_KC : filter.kcId

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
            setFilter((f) => ({ ...f, kcId: v === 'all' ? 'all' : v === NONE_KC ? null : v }))
          }}
        >
          <option value="all">모든 분류</option>
          <option value={NONE_KC}>분류 없음</option>
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
            const recall = recallByItem.get(item.id) ?? null
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
