// KC 선수지식 그래프 시각화(v15). kcGraphLayout.ts로 좌표를 구하고 SVG로 그린다.
// 화살표 방향은 "선수 KC" → "그 선수를 요구하는 KC". θ(숙달도)로 세 상태를
// 나눈다: 숙달(강조) / 준비(선수 충족, 지금 학습 가능) / 잠김(선수 미달, 옅게).
// 노드를 클릭하면 왼쪽 KC 목록의 해당 행으로 스크롤한다(같은 KC를 두 군데서
// 찾아보게 하지 않으려고).

import { useMemo } from 'react'
import type { KnowledgeComponent } from '../core/types'
import { isMastered, masteryProbability } from '../scheduler/elo'
import { layoutKcGraph } from './kcGraphLayout'

const NODE_W = 152
const NODE_H = 50
const LAYER_GAP = 192
const ROW_GAP = 64
const PADDING = 20
const NAME_MAX = 14

interface Props {
  kcs: KnowledgeComponent[]
  kcMastery: ReadonlyMap<string, number>
}

type NodeState = 'mastered' | 'ready' | 'blocked'

function nodeState(kc: KnowledgeComponent, kcMastery: ReadonlyMap<string, number>): NodeState {
  const theta = kcMastery.get(kc.id) ?? 0
  if (isMastered(theta)) return 'mastered'
  const ready = kc.prereqIds.every((id) => isMastered(kcMastery.get(id) ?? 0))
  return ready ? 'ready' : 'blocked'
}

function truncate(name: string): string {
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name
}

export function KcGraph({ kcs, kcMastery }: Props) {
  const layout = useMemo(() => layoutKcGraph(kcs), [kcs])

  if (kcs.length === 0) return null

  const width = PADDING * 2 + Math.max(0, layout.layerCount - 1) * LAYER_GAP + NODE_W
  const height = PADDING * 2 + Math.max(0, layout.maxRowCount - 1) * ROW_GAP + NODE_H

  const posOf = new Map(
    layout.nodes.map((n) => [n.kc.id, { x: PADDING + n.layer * LAYER_GAP, y: PADDING + n.row * ROW_GAP }]),
  )

  return (
    <section className="panel kc-graph">
      <h2>선수지식 그래프</h2>
      <div className="kc-graph-scroll">
        <svg width={width} height={height} className="kc-graph-svg" role="img" aria-label="KC 선수지식 그래프">
          <defs>
            <marker
              id="kc-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 z" className="kc-arrow-head" />
            </marker>
          </defs>
          {layout.edges.map((e) => {
            const from = posOf.get(e.fromId)
            const to = posOf.get(e.toId)
            if (!from || !to) return null
            const x0 = from.x + NODE_W
            const y0 = from.y + NODE_H / 2
            const x1 = to.x
            const y1 = to.y + NODE_H / 2
            const mx = (x0 + x1) / 2
            return (
              <path
                key={`${e.fromId}->${e.toId}`}
                d={`M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1}`}
                className="kc-graph-edge"
                markerEnd="url(#kc-arrow)"
              />
            )
          })}
          {layout.nodes.map(({ kc }) => {
            const pos = posOf.get(kc.id)!
            const state = nodeState(kc, kcMastery)
            const pct = Math.round(masteryProbability(kcMastery.get(kc.id) ?? 0) * 100)
            return (
              <g
                key={kc.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                className={`kc-node kc-node-${state}`}
                tabIndex={0}
                onClick={() =>
                  document
                    .getElementById(`kc-row-${kc.id}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              >
                <title>
                  {kc.name} — 숙달도 {pct}%{state === 'blocked' ? ' (선수지식 미달로 잠김)' : ''}
                </title>
                <rect width={NODE_W} height={NODE_H} rx={10} />
                <text x={10} y={21} className="kc-node-name">
                  {state === 'blocked' ? '🔒 ' : ''}
                  {truncate(kc.name)}
                </text>
                <text x={10} y={38} className="kc-node-mastery">
                  숙달도 {pct}%
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </section>
  )
}
