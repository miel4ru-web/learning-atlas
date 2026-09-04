// v6 셸 구조 — 앱 전역 상태를 한 곳(AtlasProvider)에 모으고, 화면(views/*)은
// useAtlas()로 필요한 것만 꺼내 쓴다. 예전엔 App.tsx 한 컴포넌트가 상태·파생·
// 액션·렌더를 다 들고 있었다 — 단계(v0→v5)가 쌓일수록 그 파일만 비대해졌다.
//
// 새 단계를 추가하는 법: views/ 에 컴포넌트 파일 하나 만들고 views/registry.ts에
// 한 줄 등록. 이 컨텍스트에 이미 있는 파생 상태·액션을 그대로 쓰면 되고,
// 없으면 여기에 useMemo/액션을 하나 더 얹는다(모든 화면이 자동으로 공유).

import { createContext, useContext } from 'react'
import type { FSRS } from 'ts-fsrs'
import type {
  CardState,
  Confidence,
  EloState,
  ErrorTag,
  Grade,
  Interaction,
  Item,
  KnowledgeComponent,
  NewItem,
  SchedulerSettings,
} from './types'
import type { CalibrationBucket } from './calibration'
import type { OptimizeResult } from '../scheduler/optimizer'
import type { DbSnapshot, ImportMode } from './db'

export interface AtlasData {
  // ---- 원본(IndexedDB에서 로드) ----
  loading: boolean
  now: Date
  items: Item[]
  interactions: Interaction[]
  kcs: KnowledgeComponent[]
  schedulerSettings: SchedulerSettings | undefined

  // ---- 파생(Interaction 로그 재생 — 저장 안 함) ----
  byItem: ReadonlyMap<string, Interaction[]>
  activeScheduler: FSRS
  cardStates: ReadonlyMap<string, CardState>
  eloState: EloState
  latestByItem: ReadonlyMap<string, Interaction>
  urgentKcIds: ReadonlySet<string>
  calibration: CalibrationBucket[]
  calibrationNote: string | null
  leechItems: Item[]
  leechItemIds: ReadonlySet<string>
  dueCount: number
  kcById: ReadonlyMap<string, KnowledgeComponent>

  // ---- 액션(DB를 바꾸고 reload까지 한 번에) ----
  reload: () => Promise<void>
  addItem: (input: NewItem) => Promise<void>
  addKC: (name: string, prereqIds: string[]) => Promise<void>
  deleteKC: (kcId: string) => Promise<void>
  deleteItem: (itemId: string) => Promise<void>
  recordInteraction: (
    itemId: string,
    grade: Grade,
    confidence: Confidence | null,
    errorTag: ErrorTag | null,
  ) => Promise<void>
  applyRefit: (result: OptimizeResult) => Promise<void>
  resetScheduler: () => Promise<void>
  importBackup: (snapshot: DbSnapshot, mode: ImportMode) => Promise<void>
}

export const AtlasContext = createContext<AtlasData | null>(null)

export function useAtlas(): AtlasData {
  const ctx = useContext(AtlasContext)
  if (!ctx) throw new Error('useAtlas must be used within <AtlasProvider>')
  return ctx
}
