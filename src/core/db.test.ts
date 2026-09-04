// IndexedDB 계층 통합 테스트. setup.ts가 fake-indexeddb를 전역에 깔아준다.
// db.ts는 dbPromise 싱글턴이라 파일 전체가 한 DB를 공유한다 — 각 테스트 앞에서
// importAll(빈 스냅샷, 'replace')로 네 스토어를 비운다.

import { beforeEach, describe, expect, it } from 'vitest'
import * as db from './db'
import type { DbSnapshot } from './db'
import { flashcard, mcq, kc, interaction } from '../test/factories'

const EMPTY: DbSnapshot = {
  items: [],
  interactions: [],
  kcs: [],
  schedulerSettings: null,
  studyPrefs: null,
}

beforeEach(async () => {
  await db.importAll(EMPTY, 'replace')
})

describe('items', () => {
  it('추가 후 전체 조회에 나타난다', async () => {
    const item = await db.addItem({ type: 'flashcard', front: 'Q', back: 'A', kcId: null })
    const all = await db.getAllItems()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(item.id)
  })

  it('updateItem은 id를 유지한 채 내용을 덮어쓴다', async () => {
    const item = await db.addItem({ type: 'flashcard', front: 'Q', back: 'A', kcId: null })
    await db.updateItem({ ...item, front: 'Q2' } as typeof item)
    const [reloaded] = await db.getAllItems()
    expect(reloaded.id).toBe(item.id)
    expect((reloaded as { front: string }).front).toBe('Q2')
  })

  it('deleteItem은 카드와 그 카드의 상호작용을 함께 지운다', async () => {
    const item = await db.addItem({ type: 'flashcard', front: 'Q', back: 'A', kcId: null })
    await db.recordInteraction(item.id, 'good', null, null)
    const other = await db.addItem({ type: 'flashcard', front: 'X', back: 'Y', kcId: null })
    await db.recordInteraction(other.id, 'good', null, null)

    await db.deleteItem(item.id)

    expect(await db.getAllItems()).toHaveLength(1)
    expect(await db.getInteractionsForItem(item.id)).toHaveLength(0)
    expect(await db.getInteractionsForItem(other.id)).toHaveLength(1)
  })
})

describe('일괄 작업(v16)', () => {
  it('bulkSetKc: 지정한 카드들의 kcId를 한 번에 바꾼다', async () => {
    const a = await db.addItem({ type: 'flashcard', front: 'a', back: 'a', kcId: null })
    const b = await db.addItem({ type: 'flashcard', front: 'b', back: 'b', kcId: null })
    const untouched = await db.addItem({ type: 'flashcard', front: 'c', back: 'c', kcId: 'old' })

    await db.bulkSetKc([a.id, b.id], 'k1')

    const all = await db.getAllItems()
    expect(all.find((i) => i.id === a.id)!.kcId).toBe('k1')
    expect(all.find((i) => i.id === b.id)!.kcId).toBe('k1')
    expect(all.find((i) => i.id === untouched.id)!.kcId).toBe('old')
  })

  it('bulkSetKc: null을 넘기면 분류 해제', async () => {
    const a = await db.addItem({ type: 'flashcard', front: 'a', back: 'a', kcId: 'k1' })
    await db.bulkSetKc([a.id], null)
    expect((await db.getAllItems())[0].kcId).toBeNull()
  })

  it('bulkSetKc: 이미 지워진 id가 섞여 있어도 나머지는 정상 처리', async () => {
    const a = await db.addItem({ type: 'flashcard', front: 'a', back: 'a', kcId: null })
    await db.bulkSetKc(['ghost-id', a.id], 'k1')
    expect((await db.getAllItems())[0].kcId).toBe('k1')
  })

  it('bulkDeleteItems: 카드와 그 상호작용을 함께 지운다, 나머지는 유지', async () => {
    const a = await db.addItem({ type: 'flashcard', front: 'a', back: 'a', kcId: null })
    await db.recordInteraction(a.id, 'good', null, null)
    const b = await db.addItem({ type: 'flashcard', front: 'b', back: 'b', kcId: null })
    await db.recordInteraction(b.id, 'good', null, null)
    const keep = await db.addItem({ type: 'flashcard', front: 'c', back: 'c', kcId: null })

    await db.bulkDeleteItems([a.id, b.id])

    const remaining = await db.getAllItems()
    expect(remaining.map((i) => i.id)).toEqual([keep.id])
    expect(await db.getInteractionsForItem(a.id)).toHaveLength(0)
    expect(await db.getInteractionsForItem(b.id)).toHaveLength(0)
  })
})

describe('KC 목표 파지율', () => {
  it('addKC에 넘긴 파지율이 저장되고, 안 넘기면 필드가 없다', async () => {
    await db.addKC('exam', [], 0.95)
    await db.addKC('casual', [])
    const kcs = await db.getAllKCs()
    expect(kcs.find((k) => k.name === 'exam')!.requestRetention).toBe(0.95)
    expect(kcs.find((k) => k.name === 'casual')!.requestRetention).toBeUndefined()
  })

  it('updateKC로 파지율을 바꾸거나 지운다', async () => {
    const kc = await db.addKC('k', [], 0.9)
    await db.updateKC({ ...kc, requestRetention: 0.8 })
    expect((await db.getAllKCs())[0].requestRetention).toBe(0.8)

    const withoutField = { ...kc }
    delete withoutField.requestRetention
    await db.updateKC(withoutField)
    expect((await db.getAllKCs())[0].requestRetention).toBeUndefined()
  })
})

describe('KC 삭제', () => {
  it('KC를 지우면 그 KC를 쓰던 카드의 kcId가 null이 되고, 다른 KC의 선수지식에서도 빠진다', async () => {
    await db.importAll(
      {
        items: [flashcard({ id: 'i1', kcId: 'base' }), flashcard({ id: 'i2', kcId: 'adv' })],
        interactions: [interaction('i1', 'good', 0)],
        kcs: [
          kc({ id: 'base', prereqIds: [] }),
          kc({ id: 'adv', prereqIds: ['base'] }),
        ],
        schedulerSettings: null,
        studyPrefs: null,
      },
      'replace',
    )

    await db.deleteKC('base')

    const kcs = await db.getAllKCs()
    expect(kcs.map((k) => k.id)).toEqual(['adv'])
    expect(kcs[0].prereqIds).toEqual([])

    const items = await db.getAllItems()
    expect(items.find((i) => i.id === 'i1')!.kcId).toBeNull()
    expect(items.find((i) => i.id === 'i2')!.kcId).toBe('adv')
    // 상호작용은 유지
    expect(await db.getInteractionsForItem('i1')).toHaveLength(1)
  })
})

describe('exportAll / importAll', () => {
  const sample: DbSnapshot = {
    items: [flashcard({ id: 'i1', kcId: 'k1' }), mcq({ id: 'i2' })],
    interactions: [interaction('i1', 'good', 0), interaction('i1', 'again', 1)],
    kcs: [kc({ id: 'k1' })],
    schedulerSettings: null,
    studyPrefs: null,
  }

  it('replace로 넣은 뒤 export하면 그대로 나온다', async () => {
    await db.importAll(sample, 'replace')
    const out = await db.exportAll()
    expect(out.items).toHaveLength(2)
    expect(out.interactions).toHaveLength(2)
    expect(out.kcs).toHaveLength(1)
  })

  it('merge는 같은 id를 덮어쓰고 나머지는 남긴다 (멱등)', async () => {
    await db.addItem({ type: 'flashcard', front: 'keep', back: 'me', kcId: null })
    await db.importAll(sample, 'merge')
    await db.importAll(sample, 'merge') // 두 번 넣어도 결과 동일
    const out = await db.exportAll()
    expect(out.items).toHaveLength(3) // keep + i1 + i2
  })

  it('replace는 기존 데이터를 모두 지운다', async () => {
    await db.addItem({ type: 'flashcard', front: 'gone', back: 'soon', kcId: null })
    await db.importAll(sample, 'replace')
    const out = await db.exportAll()
    expect(out.items.map((i) => i.id).sort()).toEqual(['i1', 'i2'])
  })

  it('스케줄러 설정 왕복', async () => {
    const settings = {
      w: [0.1, 0.2],
      requestRetention: 0.9,
      fittedAt: '2026-01-01T00:00:00.000Z',
      testLossBefore: 0.5,
      testLossAfter: 0.4,
    }
    await db.importAll({ ...EMPTY, schedulerSettings: settings }, 'replace')
    expect(await db.getSchedulerSettings()).toEqual(settings)
    expect((await db.exportAll()).schedulerSettings).toEqual(settings)
  })

  it('백로그/휴가 모드 설정(studyPrefs) 왕복(v18)', async () => {
    const prefs = { dailyReviewCap: 30, vacationMode: true }
    await db.importAll({ ...EMPTY, studyPrefs: prefs }, 'replace')
    expect(await db.getStudyPrefs()).toEqual(prefs)
    expect((await db.exportAll()).studyPrefs).toEqual(prefs)
  })
})

describe('studyPrefs(v18)', () => {
  it('저장 전엔 undefined', async () => {
    expect(await db.getStudyPrefs()).toBeUndefined()
  })

  it('saveStudyPrefs로 저장하고 덮어쓸 수 있다', async () => {
    await db.saveStudyPrefs({ dailyReviewCap: 20, vacationMode: false })
    expect(await db.getStudyPrefs()).toEqual({ dailyReviewCap: 20, vacationMode: false })

    await db.saveStudyPrefs({ dailyReviewCap: null, vacationMode: true })
    expect(await db.getStudyPrefs()).toEqual({ dailyReviewCap: null, vacationMode: true })
  })
})
