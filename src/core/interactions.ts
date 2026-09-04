// 로그에는 남지만 "학습 결론"에는 넣지 않는 채점이 있다 — 사전 테스트(v23)다.
// 아직 배우지 않은 걸 일부러 물어본 것이라, 틀렸다고 카드 스케줄을 당기거나
// 숙달도를 깎거나 문항 품질을 의심하면 전부 잘못된 결론이 된다(Atlas 1부
// "오답이어도 페널티 없음으로 처리").
//
// 지우지 않고 표시만 해 두는 이유는 이벤트 소싱의 원칙 그대로다: 로그는
// append-only이고, "무엇을 세느냐"는 읽는 쪽의 결정이다. 그래서 이 구분을
// 여기 한 곳에 두고, 파생 상태를 만드는 쪽(AtlasProvider)이 이 필터를 통과한
// 로그만 넘겨받는다 — fsrs/elo/calibration/stats는 이 구분을 몰라도 된다.
//
// 반대로 "내가 오늘 몇 장 했나" 같은 활동 기록에는 사전 테스트도 포함된다.
// 실제로 푼 건 맞기 때문이다.

import type { Interaction } from './types'

/** 파생 학습 상태(FSRS·Elo·캘리브레이션·문항 품질)에 반영할 채점인가. */
export function isScored(interaction: Interaction): boolean {
  return interaction.pretest !== true
}

export function scoredOnly(interactions: readonly Interaction[]): Interaction[] {
  return interactions.filter(isScored)
}

/** 사전 테스트로 이미 낸 적 있는 아이템 — 같은 카드를 반복해 들이밀지 않으려고 쓴다. */
export function pretestedItemIds(interactions: readonly Interaction[]): Set<string> {
  const ids = new Set<string>()
  for (const i of interactions) {
    if (i.pretest) ids.add(i.itemId)
  }
  return ids
}
