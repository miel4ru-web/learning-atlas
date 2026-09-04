import { useEffect, useMemo, useState } from 'react'
import type { Grade, Item, Interaction, CardState } from './core/types'
import * as db from './core/db'
import { deriveAllCardStates, isDue } from './scheduler/fsrs'
import './App.css'

function groupByItem(interactions: Interaction[]): Map<string, Interaction[]> {
  const map = new Map<string, Interaction[]>()
  for (const it of interactions) {
    const list = map.get(it.itemId)
    if (list) list.push(it)
    else map.set(it.itemId, [it])
  }
  return map
}

function formatDue(due: Date, now: Date): string {
  const diffMs = due.getTime() - now.getTime()
  if (diffMs <= 0) return '지금'
  const days = Math.round(diffMs / 86_400_000)
  if (days < 1) {
    const hours = Math.round(diffMs / 3_600_000)
    return hours <= 0 ? '곧' : `${hours}시간 후`
  }
  return `${days}일 후`
}

export default function App() {
  const [items, setItems] = useState<Item[]>([])
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [loading, setLoading] = useState(true)
  const [revealed, setRevealed] = useState(false)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [now, setNow] = useState(() => new Date())

  async function reload() {
    const [allItems, allInteractions] = await Promise.all([
      db.getAllItems(),
      db.getAllInteractions(),
    ])
    setItems(allItems)
    setInteractions(allInteractions)
    setLoading(false)
    setNow(new Date())
  }

  useEffect(() => {
    reload()
  }, [])

  // 파생 상태: Interaction 로그를 재생해서만 얻는다 — DB에 저장하지 않는다.
  const cardStates = useMemo(() => {
    const byItem = groupByItem(interactions)
    // 인터랙션이 아직 없는 아이템도 "새 카드" 상태로 포함시킨다.
    for (const item of items) {
      if (!byItem.has(item.id)) byItem.set(item.id, [])
    }
    return deriveAllCardStates(byItem)
  }, [items, interactions])

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const queue = useMemo(() => {
    const due: { item: Item; state: CardState }[] = []
    for (const [itemId, state] of cardStates) {
      const item = itemsById.get(itemId)
      if (item && isDue(state, now)) due.push({ item, state })
    }
    due.sort((a, b) => a.state.due.getTime() - b.state.due.getTime())
    return due
  }, [cardStates, itemsById, now])

  const nextUp = useMemo(() => {
    let soonest: CardState | null = null
    for (const state of cardStates.values()) {
      if (!soonest || state.due.getTime() < soonest.due.getTime()) soonest = state
    }
    return soonest
  }, [cardStates])

  const current = queue[0]

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    if (!front.trim() || !back.trim()) return
    await db.addItem(front.trim(), back.trim())
    setFront('')
    setBack('')
    await reload()
  }

  async function handleGrade(grade: Grade) {
    if (!current) return
    await db.recordInteraction(current.item.id, grade)
    setRevealed(false)
    await reload()
  }

  async function handleDelete(itemId: string) {
    await db.deleteItem(itemId)
    await reload()
  }

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">불러오는 중…</p>
      </main>
    )
  }

  return (
    <main className="shell">
      <header className="topbar">
        <h1>Learning Atlas</h1>
        <p className="stat-line">
          만기 <strong>{queue.length}</strong> · 전체 <strong>{items.length}</strong>
        </p>
      </header>

      <section className="queue">
        {current ? (
          <div className="card">
            <p className="card-front">{current.item.front}</p>
            {revealed && <p className="card-back">{current.item.back}</p>}
            {!revealed ? (
              <button className="reveal" onClick={() => setRevealed(true)}>
                답 보기
              </button>
            ) : (
              <div className="grades">
                <button className="grade grade-again" onClick={() => handleGrade('again')}>
                  다시
                </button>
                <button className="grade grade-hard" onClick={() => handleGrade('hard')}>
                  어려움
                </button>
                <button className="grade grade-good" onClick={() => handleGrade('good')}>
                  좋음
                </button>
                <button className="grade grade-easy" onClick={() => handleGrade('easy')}>
                  쉬움
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="empty">
            <p>오늘 만기인 카드가 없습니다.</p>
            {nextUp && items.length > 0 && (
              <p className="muted">다음 카드: {formatDue(nextUp.due, now)}</p>
            )}
          </div>
        )}
      </section>

      <section className="add-item">
        <h2>카드 추가</h2>
        <form onSubmit={handleAddItem}>
          <input
            value={front}
            onChange={(e) => setFront(e.target.value)}
            placeholder="앞면"
          />
          <input value={back} onChange={(e) => setBack(e.target.value)} placeholder="뒷면" />
          <button type="submit">추가</button>
        </form>
      </section>

      {items.length > 0 && (
        <section className="deck">
          <h2>전체 카드</h2>
          <ul>
            {items.map((item) => {
              const state = cardStates.get(item.id)
              return (
                <li key={item.id}>
                  <span className="deck-front">{item.front}</span>
                  <span className="deck-due muted">
                    {state ? formatDue(state.due, now) : ''}
                  </span>
                  <button className="delete" onClick={() => handleDelete(item.id)}>
                    삭제
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </main>
  )
}
