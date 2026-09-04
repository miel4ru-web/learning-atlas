// 화면 등록소 — 셸(App.tsx)·탭 바·해시 라우팅은 전부 이 배열 하나만 읽는다.
//
// v6+ 새 단계를 추가하는 법:
//   1) views/ 에 컴포넌트 파일을 만든다 (useAtlas()로 필요한 상태를 꺼내 쓴다)
//   2) 아래 VIEWS 에 { id, label, Component } 한 줄을 추가한다
// 그게 전부다 — App/TabBar/URL 해시는 손대지 않는다.

import type { ReactNode } from 'react'
import { StudyView } from './StudyView'
import { DiagnosticsView } from './DiagnosticsView'
import { CardsView } from './CardsView'
import { DataView } from './DataView'

export interface ViewDef {
  /** URL 해시로도 쓰인다(#diagnostics). 영소문자·하이픈만. */
  id: string
  /** 탭 바에 보이는 이름. */
  label: string
  Component: () => ReactNode
}

export const VIEWS: ViewDef[] = [
  { id: 'study', label: '학습', Component: StudyView },
  { id: 'diagnostics', label: '진단', Component: DiagnosticsView },
  { id: 'cards', label: '카드', Component: CardsView },
  { id: 'data', label: '데이터', Component: DataView },
]

export const VIEW_IDS: readonly string[] = VIEWS.map((v) => v.id)
export const DEFAULT_VIEW = VIEWS[0].id
