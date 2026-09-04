// 4부 도메인 모델의 v0 부분 집합: Item · Interaction 두 가지만 영속화한다.
// LearnerState(카드별 FSRS 상태)는 저장하지 않고 Interaction 로그를 재생해 매번 도출한다
// — Atlas 4.2 "이벤트 소싱" 그대로: 로그가 유일한 진실의 원천.

export type Grade = 'again' | 'hard' | 'good' | 'easy'

/** 학습 대상을 묻는 하나의 구체적 카드. v0는 flashcard 활동 하나만 지원한다. */
export interface Item {
  id: string
  front: string
  back: string
  createdAt: string // ISO-8601
}

/** 실제로 일어난 채점 사건 하나. append-only — 절대 수정·삭제하지 않는다. */
export interface Interaction {
  id: string
  itemId: string
  ts: string // ISO-8601, 채점이 일어난 시각
  grade: Grade
}

/** Interaction 로그를 재생해 얻는 파생 상태. DB에 저장하지 않는다. */
export interface CardState {
  itemId: string
  due: Date
  stability: number
  difficulty: number
  reps: number
  lapses: number
  state: 'new' | 'learning' | 'review' | 'relearning'
  lastReview: Date | null
}
