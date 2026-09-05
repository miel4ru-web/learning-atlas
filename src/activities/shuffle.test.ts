import { describe, expect, it } from 'vitest'
import { shuffledIndices } from './shuffle'

describe('shuffledIndices', () => {
  it('항상 0..n-1의 순열을 돌려준다', () => {
    for (let trial = 0; trial < 20; trial++) {
      const result = shuffledIndices(4)
      expect([...result].sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
    }
  })

  it('n=0/1이어도 에러 없이 처리한다', () => {
    expect(shuffledIndices(0)).toEqual([])
    expect(shuffledIndices(1)).toEqual([0])
  })

  it('주입한 rng로 결정적 결과를 낸다', () => {
    // rng가 항상 0을 돌려주면(Fisher-Yates에서 매번 j=0) 매 단계 자리 0과 스왑된다:
    // [0,1,2,3] → [3,1,2,0] → [2,1,3,0] → [1,2,3,0]
    expect(shuffledIndices(4, () => 0)).toEqual([1, 2, 3, 0])
  })

  it('rng가 항상 최댓값 근처를 돌려주면 j가 매번 i와 같아져 순서가 그대로다', () => {
    // j = floor(rng() * (i+1))이 항상 i가 되도록 rng()를 1에 아주 가깝게 준다 → 자기 자신과 스왑.
    expect(shuffledIndices(4, () => 0.999999)).toEqual([0, 1, 2, 3])
  })
})
