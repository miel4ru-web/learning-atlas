// 4부 도메인 모델의 v0+v1 부분 집합. Item · Interaction · KnowledgeComponent
// 세 가지만 영속화한다. CardState(FSRS)와 EloState(숙달도)는 저장하지 않고
// Interaction 로그를 재생해 매번 도출한다 — Atlas 4.2 "이벤트 소싱" 그대로:
// 로그가 유일한 진실의 원천이고, 파생 상태는 언제든 버리고 다시 계산할 수 있다.

export type Grade = 'again' | 'hard' | 'good' | 'easy'

/** 자신감 입력 — Atlas 4.5 메타인지 레이어. 응답 전(정답 공개 전)에 받는다. */
export type Confidence = 1 | 2 | 3 // 1=모르겠다, 2=애매하다, 3=확실하다

/** 학습 대상의 최소 단위(Atlas 4.1). 선수지식 DAG는 prereqIds로 표현한다. */
export interface KnowledgeComponent {
  id: string
  name: string
  prereqIds: string[] // 이 KC를 "준비된" 상태로 보려면 먼저 숙달해야 하는 KC들
  createdAt: string
}

/**
 * 학습 대상을 묻는 하나의 구체적 카드. v0는 flashcard 활동 하나만 지원한다.
 * kcId는 선택 사항 — v0처럼 KC 없이 단독 카드로 써도 된다(Elo·DAG 게이팅 대상에서 제외).
 * v1은 카드당 KC 하나로 단순화한다(Atlas의 item_kc 다대다·가중치는 필요해지면 v2에서).
 */
export interface Item {
  id: string
  front: string
  back: string
  kcId: string | null
  createdAt: string // ISO-8601
}

/** 실제로 일어난 채점 사건 하나. append-only — 절대 수정·삭제하지 않는다. */
export interface Interaction {
  id: string
  itemId: string
  ts: string // ISO-8601, 채점이 일어난 시각
  grade: Grade
  confidence: Confidence | null // 응답 전 자신감. v0 데이터 호환을 위해 null 허용.
}

/** Interaction 로그를 재생해 얻는 FSRS 파생 상태. DB에 저장하지 않는다. */
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

/** Interaction 로그를 재생해 얻는 Elo 파생 상태(Atlas 3.2). DB에 저장하지 않는다. */
export interface EloState {
  itemDifficulty: Map<string, number> // itemId → b
  kcMastery: Map<string, number> // kcId → theta
}
