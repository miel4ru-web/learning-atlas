// 4지선다 표시 순서 섞기(v32). 반복 복습에서 내용이 아니라 "몇 번째 자리인가"를
// 외우게 되는 걸 막는다 — 채점·오개념 태깅·로그(selectedIndex)는 항상 원본
// 인덱스를 그대로 쓰고, 여기서 나온 순서는 화면 표시에만 쓴다(McqRespond 참고).

/** Fisher-Yates. rng()는 [0,1) 난수를 돌려줘야 한다(기본 Math.random, 테스트는 주입). */
export function shuffledIndices(n: number, rng: () => number = Math.random): number[] {
  const indices = Array.from({ length: n }, (_, i) => i)
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  return indices
}
