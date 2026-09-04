// "카드" 화면 — 학습 대상의 정의를 관리한다. 지식 요소(KC)와 선수지식 DAG,
// 카드 추가/편집(ItemForm), 전체 목록(Deck: 검색·필터), 계속 틀려 격리된 카드.
// 채점 로그는 여기서 건드리지 않는다.

import { useState, type FormEvent } from 'react'
import { useAtlas } from '../core/atlas'
import { againCount } from '../scheduler/fsrs'
import { masteryProbability } from '../scheduler/elo'
import { ItemForm } from './ItemForm'
import { Deck } from './Deck'
import { KcGraph } from './KcGraph'
import { itemSummary } from './itemDisplay'

const RETENTION_PERCENTS = ['80', '85', '90', '95', '98']

export function CardsView() {
  const atlas = useAtlas()
  const { kcs, kcById, eloState, leechItems, byItem } = atlas

  const [kcName, setKcName] = useState('')
  const [kcPrereqIds, setKcPrereqIds] = useState<string[]>([])
  const [kcRetention, setKcRetention] = useState('') // '' = 전역 기본값 사용

  // 카드 편집: editingId가 있으면 ItemForm이 그 카드로 채워진 편집 모드가 된다.
  // formNonce는 "추가"로 저장한 뒤 폼을 비우기 위한 리마운트 키.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formNonce, setFormNonce] = useState(0)
  const editingItem = editingId ? atlas.items.find((i) => i.id === editingId) : undefined

  function closeForm() {
    setEditingId(null)
    setFormNonce((n) => n + 1)
  }

  function startEdit(id: string) {
    setEditingId(id)
    document.querySelector('.item-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleAddKc(e: FormEvent) {
    e.preventDefault()
    if (!kcName.trim()) return
    const retention = kcRetention ? Number(kcRetention) / 100 : undefined
    await atlas.addKC(kcName.trim(), kcPrereqIds, retention)
    setKcName('')
    setKcPrereqIds([])
    setKcRetention('')
  }

  function toggleKcPrereq(id: string) {
    setKcPrereqIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function setKcRetentionValue(kc: (typeof kcs)[number], percent: string) {
    const next = { ...kc }
    if (percent === '') delete next.requestRetention
    else next.requestRetention = Number(percent) / 100
    atlas.updateKC(next)
  }

  return (
    <div className="cards-layout">
      <div className="cards-forms">
        <section className="panel kcs">
          <h2>지식 요소</h2>
          {kcs.length > 0 && (
            <ul className="kc-list">
              {kcs.map((kc) => {
                const theta = eloState.kcMastery.get(kc.id) ?? 0
                const pct = Math.round(masteryProbability(theta) * 100)
                const prereqNames = kc.prereqIds.map((id) => kcById.get(id)?.name ?? '?').join(', ')
                const usedBy = atlas.items.filter((it) => it.kcId === kc.id).length
                return (
                  <li key={kc.id} id={`kc-row-${kc.id}`}>
                    <span className="kc-name">{kc.name}</span>
                    <span className="kc-mastery muted">숙달도 {pct}%</span>
                    {prereqNames && <span className="kc-prereq muted">선수: {prereqNames}</span>}
                    <label className="kc-retention muted" title="이 지식 요소의 목표 파지율">
                      목표
                      <select
                        value={
                          kc.requestRetention != null
                            ? String(Math.round(kc.requestRetention * 100))
                            : ''
                        }
                        onChange={(e) => setKcRetentionValue(kc, e.target.value)}
                      >
                        <option value="">기본</option>
                        {RETENTION_PERCENTS.map((p) => (
                          <option key={p} value={p}>
                            {p}%
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="delete kc-delete"
                      onClick={() => atlas.deleteKC(kc.id)}
                      title={
                        usedBy > 0
                          ? `카드 ${usedBy}장의 분류가 해제됩니다 (카드는 삭제되지 않음)`
                          : undefined
                      }
                    >
                      삭제
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <form onSubmit={handleAddKc} className="kc-form">
            <input
              value={kcName}
              onChange={(e) => setKcName(e.target.value)}
              placeholder="새 지식 요소 이름"
            />
            {kcs.length > 0 && (
              <div className="kc-prereq-picker">
                <span className="muted">선수지식:</span>
                {kcs.map((kc) => (
                  <label key={kc.id}>
                    <input
                      type="checkbox"
                      checked={kcPrereqIds.includes(kc.id)}
                      onChange={() => toggleKcPrereq(kc.id)}
                    />
                    {kc.name}
                  </label>
                ))}
              </div>
            )}
            <label className="kc-retention-field muted">
              목표 파지율
              <select value={kcRetention} onChange={(e) => setKcRetention(e.target.value)}>
                <option value="">기본 (전역)</option>
                {RETENTION_PERCENTS.map((p) => (
                  <option key={p} value={p}>
                    {p}%
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">지식 요소 추가</button>
          </form>
        </section>

        <ItemForm
          key={editingId ?? `new-${formNonce}`}
          kcs={kcs}
          initial={editingItem}
          onDone={closeForm}
        />
      </div>

      <div className="cards-main">
        {atlas.items.length === 0 && leechItems.length === 0 && (
          <section className="panel empty-note">
            <p className="muted">아직 카드가 없습니다. 위에서 첫 카드를 추가해 보세요.</p>
          </section>
        )}

        <KcGraph kcs={kcs} kcMastery={eloState.kcMastery} />

        {leechItems.length > 0 && (
          <section className="panel leeches">
            <h2>격리된 카드</h2>
            <p className="muted">계속 틀려서(다시 등급 4회 이상) 세션에서 잠시 뺐습니다.</p>
            <ul>
              {leechItems.map((item) => (
                <li key={item.id}>
                  <span className="deck-front">{itemSummary(item)}</span>
                  <span className="muted">{againCount(byItem.get(item.id) ?? [])}회 실패</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {atlas.items.length > 0 && <Deck editingId={editingId} onEdit={startEdit} />}
      </div>
    </div>
  )
}
