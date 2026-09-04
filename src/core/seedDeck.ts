// 콜드스타트용 예시 덱(Atlas 6부 함정 "콜드스타트 방치" — 첫 세션에서 낼 문항이
// 없으면 앱은 거기서 끝난다. 문서가 제시한 두 대안 중 "기본 덱" 쪽을 택했다:
// 짧은 진단(CAT)은 문항 모수를 보정할 대량 응답이 필요해 1인 앱에는 맞지 않는다).
//
// 소재는 이 앱이 구현하고 있는 학습 원리 자체다 — 예시 덱을 한 번 돌려 보는 동안
// 왜 이렇게 동작하는지도 같이 익히게 된다. 다섯 활동 타입과 선수지식 DAG를 모두
// 한 번씩 쓰므로, 기능 둘러보기 역할도 겸한다.
//
// id를 고정해 두는 이유: 가져오기는 merge(같은 id면 덮어쓰기)라 여러 번 넣어도
// 카드가 불어나지 않는다. 채점 로그는 넣지 않는다 — 남의 학습 기록을 심는 셈이라
// 파생 상태(FSRS·Elo)가 거짓말을 하게 된다.

import type { DbSnapshot } from './db'
import type { Item, KnowledgeComponent } from './types'

const CREATED_AT = '2026-01-01T00:00:00.000Z'

const kcs: KnowledgeComponent[] = [
  { id: 'seed-kc-basics', name: '학습 원리 기초', prereqIds: [], createdAt: CREATED_AT },
  {
    id: 'seed-kc-scheduling',
    name: '간격 반복 스케줄링',
    prereqIds: ['seed-kc-basics'],
    createdAt: CREATED_AT,
  },
  {
    id: 'seed-kc-practice',
    name: '연습 설계',
    prereqIds: ['seed-kc-basics'],
    createdAt: CREATED_AT,
  },
]

const items: Item[] = [
  // ---- 학습 원리 기초 ----
  {
    id: 'seed-i1',
    type: 'flashcard',
    kcId: 'seed-kc-basics',
    createdAt: CREATED_AT,
    front: '인출 연습(retrieval practice)이란?',
    back: '자료를 다시 보는 대신 기억에서 꺼내 보는 것. 꺼내는 행위 자체가 기억을 강화한다.',
  },
  {
    id: 'seed-i2',
    type: 'flashcard',
    kcId: 'seed-kc-basics',
    createdAt: CREATED_AT,
    front: '분산 학습(distributed practice)이란?',
    back: '같은 총 시간을 한 번에 몰아서가 아니라 여러 날에 나눠 배치하는 것.',
  },
  {
    id: 'seed-i3',
    type: 'short',
    kcId: 'seed-kc-basics',
    createdAt: CREATED_AT,
    prompt: '"보는 것이 아니라 기억에서 꺼내게 하라"는 원리의 이름은?',
    acceptedAnswers: ['인출 연습', '인출연습', 'retrieval practice'],
  },
  {
    id: 'seed-i4',
    type: 'mcq',
    kcId: 'seed-kc-basics',
    createdAt: CREATED_AT,
    prompt: '다음 중 효과 근거가 가장 약한 학습 기법은?',
    options: ['교재에 밑줄 긋기', '스스로 시험 보기', '여러 날에 나눠 공부하기', '왜 그런지 설명해 보기'],
    correctIndex: 0,
    distractorTags: [
      null,
      '시험을 "평가"로만 보고 학습 수단으로 여기지 않음',
      '분산 학습을 단순한 시간 배분 요령으로 오해',
      '설명하기를 정리·요약과 같은 것으로 봄',
    ],
  },
  {
    id: 'seed-i5',
    type: 'cloze',
    kcId: 'seed-kc-basics',
    createdAt: CREATED_AT,
    text: '근거가 가장 두터운 두 기법은 인출 연습과 {{분산 학습}}이다.',
  },
  {
    id: 'seed-i16',
    type: 'free_text',
    kcId: 'seed-kc-basics',
    createdAt: CREATED_AT,
    prompt: '왜 같은 시간을 몰아서 쓰는 것보다 여러 날에 나눠 쓰는 편이 오래 남을까?',
    modelAnswer:
      '몰아서 보면 기억이 아직 생생한 상태에서 다시 보는 것이라 꺼내는 일이 거의 없다. 시간을 두면 기억이 흐려진 뒤에 다시 꺼내게 되고, 그 "힘들여 꺼내는" 과정 자체가 기억을 강하게 만든다. 게다가 매번 다른 맥락에서 꺼내므로 나중에 다른 상황에서도 떠올리기 쉬워진다.',
    keyPoints: [
      '몰아서 하면 인출이 거의 일어나지 않는다',
      '잊힐 즈음의 인출이 기억을 강화한다',
      '여러 맥락에서 꺼내 본 기억이 더 잘 전이된다',
    ],
  },

  // ---- 간격 반복 스케줄링 ----
  {
    id: 'seed-i6',
    type: 'flashcard',
    kcId: 'seed-kc-scheduling',
    createdAt: CREATED_AT,
    front: 'FSRS가 카드마다 추적하는 세 변수는?',
    back: '난이도(D), 안정성(S), 인출가능성(R).',
  },
  {
    id: 'seed-i7',
    type: 'short',
    kcId: 'seed-kc-scheduling',
    createdAt: CREATED_AT,
    prompt: 'FSRS에서 "지금 이 카드를 떠올릴 수 있을 확률"을 뜻하는 변수는?',
    acceptedAnswers: ['R', '인출가능성', 'retrievability'],
  },
  {
    id: 'seed-i8',
    type: 'mcq',
    kcId: 'seed-kc-scheduling',
    createdAt: CREATED_AT,
    prompt: '목표 파지율을 0.90에서 0.95로 올리면?',
    options: [
      '복습이 잦아진다(간격이 짧아진다)',
      '복습이 뜸해진다(간격이 길어진다)',
      '아무 변화가 없다',
      '카드가 자동으로 삭제된다',
    ],
    correctIndex: 0,
  },
  {
    id: 'seed-i9',
    type: 'cloze',
    kcId: 'seed-kc-scheduling',
    createdAt: CREATED_AT,
    text: '다음 복습 간격은 목표 파지율과 카드의 {{안정성}}에서 역산된다.',
  },
  {
    id: 'seed-i10',
    type: 'flashcard',
    kcId: 'seed-kc-scheduling',
    createdAt: CREATED_AT,
    front: 'leech(격리)란?',
    back: '같은 방식으로 반복해서 실패하는 카드를 세션에서 잠시 빼는 것. 계속 들이미는 건 도움이 안 된다.',
  },

  // ---- 연습 설계 ----
  {
    id: 'seed-i11',
    type: 'flashcard',
    kcId: 'seed-kc-practice',
    createdAt: CREATED_AT,
    front: '인터리빙(interleaving)이란?',
    back: '유형을 섞어 내서 "어떤 방법을 써야 하는지"까지 스스로 인출하게 하는 것.',
  },
  {
    id: 'seed-i12',
    type: 'short',
    kcId: 'seed-kc-practice',
    createdAt: CREATED_AT,
    prompt: '당장의 수행은 낮추지만 오래 남는 학습을 만드는 조건을 뭐라 하나?',
    acceptedAnswers: ['바람직한 어려움', 'desirable difficulty', '바람직한어려움'],
  },
  {
    id: 'seed-i13',
    type: 'mcq',
    kcId: 'seed-kc-practice',
    createdAt: CREATED_AT,
    prompt: '"바람직한 어려움" 밴드로 삼는 예상 정답률 구간은?',
    options: ['0.70 ~ 0.85', '0.95 ~ 1.00', '0.40 ~ 0.50', '정답률과는 무관하다'],
    correctIndex: 0,
    distractorTags: [
      null,
      '쉬울수록 잘 배운다고 봄 — "쉬움"을 학습 지표로 착각',
      '어려울수록 좋다고 봄 — 이탈 위험을 고려하지 않음',
      '난이도 조절이 학습량과 무관하다고 봄',
    ],
  },
  {
    id: 'seed-i14',
    type: 'cloze',
    kcId: 'seed-kc-practice',
    createdAt: CREATED_AT,
    text: '배우기 전에 일부러 먼저 틀려 보게 하는 것을 {{사전 테스트}}라고 한다.',
  },
  {
    id: 'seed-i15',
    type: 'code',
    kcId: 'seed-kc-practice',
    createdAt: CREATED_AT,
    prompt: '정답 수와 전체 수를 받아 정답률을 돌려주는 solve(correct, total)을 완성하세요. 전체가 0이면 0을 돌려줍니다.',
    starterCode: 'function solve(correct, total) {\n  \n}',
    tests: [
      { args: [8, 10], expected: 0.8 },
      { args: [0, 4], expected: 0 },
      { args: [3, 0], expected: 0 },
    ],
  },
]

/** 가져오기(merge)에 그대로 넣을 수 있는 스냅샷. 채점 로그·설정은 비어 있다. */
export function seedDeck(): DbSnapshot {
  return {
    items,
    interactions: [],
    kcs,
    schedulerSettings: null,
    studyPrefs: null,
  }
}

export const SEED_DECK_SIZE = items.length
