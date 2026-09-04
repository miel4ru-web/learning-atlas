import { describe, expect, it } from 'vitest'
import { layoutKcGraph } from './kcGraphLayout'
import { kc } from '../test/factories'

describe('layoutKcGraph', () => {
  it('빈 목록 → 빈 레이아웃', () => {
    const layout = layoutKcGraph([])
    expect(layout.nodes).toEqual([])
    expect(layout.edges).toEqual([])
    expect(layout.layerCount).toBe(0)
    expect(layout.maxRowCount).toBe(0)
  })

  it('선수지식 없는 KC는 전부 0층, 서로 다른 행', () => {
    const a = kc({ id: 'a', name: 'A' })
    const b = kc({ id: 'b', name: 'B' })
    const layout = layoutKcGraph([a, b])
    expect(layout.nodes.map((n) => n.layer)).toEqual([0, 0])
    expect(layout.nodes.map((n) => n.row)).toEqual([0, 1])
    expect(layout.layerCount).toBe(1)
    expect(layout.maxRowCount).toBe(2)
    expect(layout.edges).toEqual([])
  })

  it('선형 체인: layer가 선수지식 경로 길이를 따라간다', () => {
    const a = kc({ id: 'a', prereqIds: [] })
    const b = kc({ id: 'b', prereqIds: ['a'] })
    const c = kc({ id: 'c', prereqIds: ['b'] })
    const layout = layoutKcGraph([a, b, c])
    const layerById = new Map(layout.nodes.map((n) => [n.kc.id, n.layer]))
    expect(layerById.get('a')).toBe(0)
    expect(layerById.get('b')).toBe(1)
    expect(layerById.get('c')).toBe(2)
    expect(layout.layerCount).toBe(3)
    expect(layout.edges).toEqual([
      { fromId: 'a', toId: 'b' },
      { fromId: 'b', toId: 'c' },
    ])
  })

  it('다이아몬드(두 선수 합류): layer는 더 긴 경로를 따른다', () => {
    // a -> b -> d
    // a -> c -> c2 -> d   (c 쪽 경로가 하나 더 길다)
    const a = kc({ id: 'a', prereqIds: [] })
    const b = kc({ id: 'b', prereqIds: ['a'] })
    const c = kc({ id: 'c', prereqIds: ['a'] })
    const c2 = kc({ id: 'c2', prereqIds: ['c'] })
    const d = kc({ id: 'd', prereqIds: ['b', 'c2'] })
    const layout = layoutKcGraph([a, b, c, c2, d])
    const layerById = new Map(layout.nodes.map((n) => [n.kc.id, n.layer]))
    expect(layerById.get('a')).toBe(0)
    expect(layerById.get('b')).toBe(1)
    expect(layerById.get('c')).toBe(1)
    expect(layerById.get('c2')).toBe(2)
    expect(layerById.get('d')).toBe(3) // max(b=1, c2=2) + 1
  })

  it('죽은 선수지식 참조(존재하지 않는 kcId)는 무시한다', () => {
    const a = kc({ id: 'a', prereqIds: ['ghost'] })
    const layout = layoutKcGraph([a])
    expect(layout.nodes[0].layer).toBe(0)
    expect(layout.edges).toEqual([])
  })

  it('순환이 있어도 무한루프 없이 끝난다(방어적 처리)', () => {
    const a = kc({ id: 'a', prereqIds: ['b'] })
    const b = kc({ id: 'b', prereqIds: ['a'] })
    const layout = layoutKcGraph([a, b])
    expect(layout.nodes).toHaveLength(2)
    expect(layout.nodes.every((n) => Number.isFinite(n.layer))).toBe(true)
  })
})
