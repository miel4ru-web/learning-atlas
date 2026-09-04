// KC 선수지식 DAG를 화면 좌표로 바꾸는 순수 함수(v15). 레이어드 그래프
// (Sugiyama 기법의 단순판) — layer(kc) = 이 KC로 이어지는 가장 긴 선수지식
// 경로 길이(선수가 없으면 0층). 개인 학습 규모(KC 수십 개)라 교차 최소화 같은
// 정교한 배치는 생략하고, 레이어 안에서는 kcs 배열 순서(생성 순)를 그대로 쓴다
// — 결정적이고 매번 같은 그림이 나온다.

import type { KnowledgeComponent } from '../core/types'

export interface KcGraphNode {
  kc: KnowledgeComponent
  layer: number
  row: number
}

export interface KcGraphEdge {
  /** 선수 KC id. */
  fromId: string
  /** 그 선수를 요구하는 KC id. */
  toId: string
}

export interface KcGraphLayout {
  nodes: KcGraphNode[]
  edges: KcGraphEdge[]
  layerCount: number
  maxRowCount: number
}

export function layoutKcGraph(kcs: readonly KnowledgeComponent[]): KcGraphLayout {
  const byId = new Map(kcs.map((kc) => [kc.id, kc]))
  const layerOf = new Map<string, number>()
  const inProgress = new Set<string>() // 순환 방어 — deleteKC가 참조를 정리하므로 정상 데이터엔 없다

  function layerFor(id: string): number {
    const cached = layerOf.get(id)
    if (cached !== undefined) return cached
    if (inProgress.has(id)) return 0 // 순환 발견 — 더 내려가지 않고 끊는다(방어적 기본값)
    inProgress.add(id)
    const prereqIds = byId.get(id)?.prereqIds ?? []
    const prereqLayers = prereqIds.filter((p) => byId.has(p)).map(layerFor)
    const layer = prereqLayers.length > 0 ? Math.max(...prereqLayers) + 1 : 0
    inProgress.delete(id)
    layerOf.set(id, layer)
    return layer
  }

  for (const kc of kcs) layerFor(kc.id)

  const rowCounters = new Map<number, number>()
  const nodes: KcGraphNode[] = kcs.map((kc) => {
    const layer = layerOf.get(kc.id) ?? 0
    const row = rowCounters.get(layer) ?? 0
    rowCounters.set(layer, row + 1)
    return { kc, layer, row }
  })

  const edges: KcGraphEdge[] = []
  for (const kc of kcs) {
    for (const prereqId of kc.prereqIds) {
      if (byId.has(prereqId)) edges.push({ fromId: prereqId, toId: kc.id })
    }
  }

  return {
    nodes,
    edges,
    layerCount: nodes.length > 0 ? Math.max(...nodes.map((n) => n.layer)) + 1 : 0,
    maxRowCount: rowCounters.size > 0 ? Math.max(...rowCounters.values()) : 0,
  }
}
