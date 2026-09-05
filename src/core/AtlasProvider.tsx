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
import { pretestedItemIds, scoredOnly } from './interactions'
import { buildSchedulerForItem, countDue, groupByItem } from './dueCount'
import { AtlasContext, type AtlasData } from './atlas'

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
  const [studyPrefs, setStudyPrefs] = useState<db.DbSnapshot['studyPrefs']>(null)
  const [sessions, setSessions] = useState<db.DbSnapshot['sessions']>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => new Date())
  const [sessionScopeItemIds, setSessionScopeItemIds] = useState<ReadonlySet<string> | null>(null)

  const reload = useCallback(async () => {
    const [allItems, allInteractions, allKcs, settings, prefs, allSessions] = await Promise.all([
      db.getAllItems(),
      db.getAllInteractions(),
      db.getAllKCs(),
      db.getSchedulerSettings(),
      db.getStudyPrefs(),
      db.getAllSessions(),
    ])
    setItems(allItems)
    setInteractions(allInteractions)
    setKcs(allKcs)
    setSchedulerSettings(settings ?? null)
    setStudyPrefs(prefs ?? null)
    setSessions(allSessions)
    setLoading(false)
    setNow(new Date())
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // 파생 상태 — 전부 Interaction 로그를 재생해서만 얻는다(DB에 저장하지 않음).
  //
  // 단 사전 테스트(v23)는 빼고 재생한다. 아직 안 배운 걸 물어본 채점이라 스케줄·
  // 숙달도·캘리브레이션·문항 품질 어디에 넣어도 잘못된 결론이 된다. 구분은
  // core/interactions.ts가 전담하므로 아래 계산들은 이 사실을 몰라도 된다.
  // (원본 interactions는 그대로 남아 "오늘 몇 장 했나" 같은 활동 집계에 쓰인다.)
  const scored = useMemo(() => scoredOnly(interactions), [interactions])

  const byItem = useMemo(() => groupByItem(items, scored), [items, scored])

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

  // 아이템 → (그 KC의 목표 파지율로 만든) 스케줄러. core/dueCount.ts의
  // buildSchedulerForItem이 서비스 워커와 공유하는 구현이다(중복 없음).
  const schedulerForItem = useMemo(
    () => buildSchedulerForItem(items, kcs, schedulerSettings ?? null),
    [items, kcs, schedulerSettings],
  )

  const cardStates = useMemo<Map<string, CardState>>(
    () => deriveAllCardStates(byItem, schedulerForItem),
    [byItem, schedulerForItem],
  )
  const eloState = useMemo(() => deriveEloState(items, scored), [items, scored])
  const latestByItem = useMemo(() => latestPerItem(scored), [scored])
  const urgentKcIds = useMemo(() => findUrgentKcIds(items, latestByItem), [items, latestByItem])
  const calibration = useMemo(() => calibrationReport(scored), [scored])
  // 사전 테스트로 이미 낸 카드 — 같은 걸 매 세션 반복해 들이밀지 않기 위해.
  const pretestedIds = useMemo(() => pretestedItemIds(interactions), [interactions])
  const calibrationNote = useMemo(() => calibrationWarning(calibration), [calibration])

  // leech 판정은 CardState가 아니라 아이템별 원본 Interaction 목록으로 한다
  // (fsrs.ts isLeech 주석 참고 — CardState.lapses는 이 용도에 안 맞는다).
  const leechItems = useMemo(
    () => items.filter((item) => isLeech(byItem.get(item.id) ?? [])),
    [items, byItem],
  )
  const leechItemIds = useMemo(() => new Set(leechItems.map((i) => i.id)), [leechItems])

  // 만기 판정 규칙 자체(core/dueCount.ts countDue)는 서비스 워커·리마인더 훅과
  // 공유한다 — 여기서 복사해 두면 한쪽만 고쳐지는 사고가 난다.
  const dueCount = useMemo(() => countDue(cardStates, leechItemIds, now), [cardStates, leechItemIds, now])

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
  const bulkSetKc = useCallback<AtlasData['bulkSetKc']>(
    async (itemIds, kcId) => {
      await db.bulkSetKc(itemIds, kcId)
      await reload()
    },
    [reload],
  )
  const bulkDeleteItems = useCallback<AtlasData['bulkDeleteItems']>(
    async (itemIds) => {
      await db.bulkDeleteItems(itemIds)
      await reload()
    },
    [reload],
  )
  const saveStudyPrefs = useCallback<AtlasData['saveStudyPrefs']>(
    async (prefs) => {
      await db.saveStudyPrefs(prefs)
      await reload()
    },
    [reload],
  )
  const startStudySession = useCallback<AtlasData['startStudySession']>(
    async (session) => {
      const created = await db.startSession(session)
      await reload()
      return created
    },
    [reload],
  )
  const endStudySession = useCallback<AtlasData['endStudySession']>(
    async (sessionId) => {
      await db.endSession(sessionId, new Date().toISOString())
      await reload()
    },
    [reload],
  )
  // 정책 버전(v19)은 화면이 알 필요가 없다 — 지금 활성인 재적합 설정을 들고 있는
  // 여기서 붙인다. 재적합을 적용/해제한 시점 전후를 나중에 로그만으로 가를 수 있다(3.6).
  const recordInteraction = useCallback<AtlasData['recordInteraction']>(
    async (itemId, grade, confidence, errorTag, signals) => {
      await db.recordInteraction(itemId, grade, confidence, errorTag, {
        ...signals,
        policyVersion: schedulerSettings?.fittedAt ?? 'default',
      })
      await reload()
    },
    [reload, schedulerSettings],
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
      studyPrefs: studyPrefs ?? undefined,
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
      pretestedIds,
      sessions,
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
      bulkSetKc,
      bulkDeleteItems,
      saveStudyPrefs,
      startStudySession,
      endStudySession,
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
      studyPrefs,
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
      pretestedIds,
      sessions,
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
      bulkSetKc,
      bulkDeleteItems,
      saveStudyPrefs,
      startStudySession,
      endStudySession,
      recordInteraction,
      applyRefit,
      resetScheduler,
      importBackup,
    ],
  )

  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>
}
