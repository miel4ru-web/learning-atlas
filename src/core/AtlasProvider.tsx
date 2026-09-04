// AtlasContext(core/atlas.ts)의 값을 실제로 만드는 컴포넌트. 예전 App.tsx의
// 상태·useEffect·파생 useMemo·액션 래퍼가 통째로 여기로 왔다 — 렌더 트리에서
// 분리해서, 화면(views/*)은 순수하게 "받은 데이터를 그린다"만 하게 한다.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CardState, Interaction, Item } from './types'
import * as db from './db'
import { deriveAllCardStates, isLeech, buildScheduler } from '../scheduler/fsrs'
import { deriveEloState } from '../scheduler/elo'
import { findUrgentKcIds } from '../scheduler/session'
import { calibrationReport, calibrationWarning } from './calibration'
import { AtlasContext, type AtlasData } from './atlas'

function groupByItem(interactions: Interaction[]): Map<string, Interaction[]> {
  const map = new Map<string, Interaction[]>()
  for (const it of interactions) {
    const list = map.get(it.itemId)
    if (list) list.push(it)
    else map.set(it.itemId, [it])
  }
  return map
}

function latestPerItem(interactions: Interaction[]): Map<string, Interaction> {
  const latest = new Map<string, Interaction>()
  for (const it of interactions) {
    const prev = latest.get(it.itemId)
    if (!prev || it.ts > prev.ts) latest.set(it.itemId, it)
  }
  return latest
}

export function AtlasProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [kcs, setKcs] = useState<db.DbSnapshot['kcs']>([])
  const [schedulerSettings, setSchedulerSettings] = useState<db.DbSnapshot['schedulerSettings']>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => new Date())
  const [sessionScopeItemIds, setSessionScopeItemIds] = useState<ReadonlySet<string> | null>(null)

  const reload = useCallback(async () => {
    const [allItems, allInteractions, allKcs, settings] = await Promise.all([
      db.getAllItems(),
      db.getAllInteractions(),
      db.getAllKCs(),
      db.getSchedulerSettings(),
    ])
    setItems(allItems)
    setInteractions(allInteractions)
    setKcs(allKcs)
    setSchedulerSettings(settings ?? null)
    setLoading(false)
    setNow(new Date())
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // 파생 상태 — 전부 Interaction 로그를 재생해서만 얻는다(DB에 저장하지 않음).
  const byItem = useMemo(() => {
    const map = groupByItem(interactions)
    for (const item of items) {
      if (!map.has(item.id)) map.set(item.id, [])
    }
    return map
  }, [items, interactions])

  // v3: 저장된 재적합 파라미터가 있으면 그 가중치(w)로, 없으면 FSRS-6 기본값으로.
  // v11(Atlas 5부): 목표 파지율은 전역 하나가 아니라 KC마다 다를 수 있다 —
  // w(재적합 결과)는 전역이고 파지율만 KC별로 갈아 끼운다.
  const globalRetention = schedulerSettings?.requestRetention ?? 0.9
  const customWeights = schedulerSettings?.w

  // Dashboard의 모델 정확도(3.6 시뮬레이션)는 파지율과 무관하므로 전역 하나면 된다.
  const activeScheduler = useMemo(
    () => buildScheduler(customWeights ? { w: customWeights, request_retention: globalRetention } : {}),
    [customWeights, globalRetention],
  )

  // 아이템 → (그 KC의 목표 파지율로 만든) 스케줄러. 등장하는 파지율 값마다
  // 인스턴스를 하나만 미리 만들어 두고, 반환 함수는 조회만 한다.
  const schedulerForItem = useMemo(() => {
    const retentionOfKc = new Map(kcs.map((k) => [k.id, k.requestRetention]))
    const itemKc = new Map(items.map((it) => [it.id, it.kcId]))

    const retentions = new Set<number>([globalRetention])
    for (const k of kcs) if (k.requestRetention != null) retentions.add(k.requestRetention)

    const byRetention = new Map<number, ReturnType<typeof buildScheduler>>()
    for (const r of retentions) {
      byRetention.set(
        r,
        buildScheduler(customWeights ? { w: customWeights, request_retention: r } : { request_retention: r }),
      )
    }

    return (itemId: string) => {
      const kcId = itemKc.get(itemId) ?? null
      const r = (kcId !== null ? retentionOfKc.get(kcId) : undefined) ?? globalRetention
      return byRetention.get(r) ?? byRetention.get(globalRetention)!
    }
  }, [kcs, items, customWeights, globalRetention])

  const cardStates = useMemo<Map<string, CardState>>(
    () => deriveAllCardStates(byItem, schedulerForItem),
    [byItem, schedulerForItem],
  )
  const eloState = useMemo(() => deriveEloState(items, interactions), [items, interactions])
  const latestByItem = useMemo(() => latestPerItem(interactions), [interactions])
  const urgentKcIds = useMemo(() => findUrgentKcIds(items, latestByItem), [items, latestByItem])
  const calibration = useMemo(() => calibrationReport(interactions), [interactions])
  const calibrationNote = useMemo(() => calibrationWarning(calibration), [calibration])

  // leech 판정은 CardState가 아니라 아이템별 원본 Interaction 목록으로 한다
  // (fsrs.ts isLeech 주석 참고 — CardState.lapses는 이 용도에 안 맞는다).
  const leechItems = useMemo(
    () => items.filter((item) => isLeech(byItem.get(item.id) ?? [])),
    [items, byItem],
  )
  const leechItemIds = useMemo(() => new Set(leechItems.map((i) => i.id)), [leechItems])

  const dueCount = useMemo(() => {
    let n = 0
    for (const [itemId, state] of cardStates) {
      if (state.state !== 'new' && state.due.getTime() <= now.getTime() && !leechItemIds.has(itemId)) {
        n++
      }
    }
    return n
  }, [cardStates, now, leechItemIds])

  const kcById = useMemo(() => new Map(kcs.map((k) => [k.id, k])), [kcs])

  // 세션 범위는 DB를 안 건드리는 순수 UI 상태라 reload가 필요 없다.
  const setSessionScope = useCallback<AtlasData['setSessionScope']>((itemIds) => {
    setSessionScopeItemIds(new Set(itemIds))
  }, [])
  const clearSessionScope = useCallback<AtlasData['clearSessionScope']>(() => {
    setSessionScopeItemIds(null)
  }, [])

  // ---- 액션: DB 변경 후 reload 까지 한 번에 ----
  const addItem = useCallback<AtlasData['addItem']>(
    async (input) => {
      await db.addItem(input)
      await reload()
    },
    [reload],
  )
  const updateItem = useCallback<AtlasData['updateItem']>(
    async (item) => {
      await db.updateItem(item)
      await reload()
    },
    [reload],
  )
  const addKC = useCallback<AtlasData['addKC']>(
    async (name, prereqIds, requestRetention) => {
      await db.addKC(name, prereqIds, requestRetention)
      await reload()
    },
    [reload],
  )
  const updateKC = useCallback<AtlasData['updateKC']>(
    async (kc) => {
      await db.updateKC(kc)
      await reload()
    },
    [reload],
  )
  const deleteKC = useCallback<AtlasData['deleteKC']>(
    async (kcId) => {
      await db.deleteKC(kcId)
      await reload()
    },
    [reload],
  )
  const deleteItem = useCallback<AtlasData['deleteItem']>(
    async (itemId) => {
      await db.deleteItem(itemId)
      await reload()
    },
    [reload],
  )
  const recordInteraction = useCallback<AtlasData['recordInteraction']>(
    async (itemId, grade, confidence, errorTag) => {
      await db.recordInteraction(itemId, grade, confidence, errorTag)
      await reload()
    },
    [reload],
  )
  const applyRefit = useCallback<AtlasData['applyRefit']>(
    async (result) => {
      await db.saveSchedulerSettings({
        w: result.weights,
        requestRetention: result.requestRetention,
        fittedAt: new Date().toISOString(),
        testLossBefore: result.testLossBefore,
        testLossAfter: result.testLossAfter,
      })
      await reload()
    },
    [reload],
  )
  const resetScheduler = useCallback<AtlasData['resetScheduler']>(async () => {
    await db.clearSchedulerSettings()
    await reload()
  }, [reload])
  const importBackup = useCallback<AtlasData['importBackup']>(
    async (snapshot, mode) => {
      await db.importAll(snapshot, mode)
      await reload()
    },
    [reload],
  )

  const value = useMemo<AtlasData>(
    () => ({
      loading,
      now,
      items,
      interactions,
      kcs,
      schedulerSettings: schedulerSettings ?? undefined,
      byItem,
      activeScheduler,
      cardStates,
      eloState,
      latestByItem,
      urgentKcIds,
      calibration,
      calibrationNote,
      leechItems,
      leechItemIds,
      dueCount,
      kcById,
      sessionScopeItemIds,
      setSessionScope,
      clearSessionScope,
      reload,
      addItem,
      updateItem,
      addKC,
      updateKC,
      deleteKC,
      deleteItem,
      recordInteraction,
      applyRefit,
      resetScheduler,
      importBackup,
    }),
    [
      loading,
      now,
      items,
      interactions,
      kcs,
      schedulerSettings,
      byItem,
      activeScheduler,
      cardStates,
      eloState,
      latestByItem,
      urgentKcIds,
      calibration,
      calibrationNote,
      leechItems,
      leechItemIds,
      dueCount,
      kcById,
      sessionScopeItemIds,
      setSessionScope,
      clearSessionScope,
      reload,
      addItem,
      updateItem,
      addKC,
      updateKC,
      deleteKC,
      deleteItem,
      recordInteraction,
      applyRefit,
      resetScheduler,
      importBackup,
    ],
  )

  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>
}
