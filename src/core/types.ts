// 4부 도메인 모델의 v0+v1+v2 부분 집합. Item · Interaction · KnowledgeComponent
// 세 가지만 영속화한다. CardState(FSRS)와 EloState(숙달도)는 저장하지 않고
// Interaction 로그를 재생해 매번 도출한다 — Atlas 4.2 "이벤트 소싱" 그대로:
// 로그가 유일한 진실의 원천이고, 파생 상태는 언제든 버리고 다시 계산할 수 있다.

export type Grade = 'again' | 'hard' | 'good' | 'easy'

/** 자신감 입력 — Atlas 4.5 메타인지 레이어. 응답 전(정답 공개 전)에 받는다. */
export type Confidence = 1 | 2 | 3 // 1=모르겠다, 2=애매하다, 3=확실하다

/**
 * 오답 원인 분류(Atlas 2부 ERR). again으로 채점될 때만 선택(건너뛰기 가능).
 * concept는 session.ts의 재출제 가중치에 실제로 쓰인다(같은 KC를 앞당김).
 */
export type ErrorTag = 'concept' | 'procedure' | 'carelessness' | 'time'

/** 학습 대상의 최소 단위(Atlas 4.1). 선수지식 DAG는 prereqIds로 표현한다. */
export interface KnowledgeComponent {
  id: string
  name: string
  prereqIds: string[] // 이 KC를 "준비된" 상태로 보려면 먼저 숙달해야 하는 KC들
  createdAt: string
}

interface ItemBase {
  id: string
  kcId: string | null // v1 단순화: 카드당 KC 하나(Atlas의 item_kc 다대다·가중치는 필요해지면 v3에서)
  createdAt: string // ISO-8601
}

/** v0의 활동 타입. 정답을 자기 채점(4단계)한다 — 그 판단 자체가 학습 신호다. */
export interface FlashcardItem extends ItemBase {
  type: 'flashcard'
  front: string
  back: string
}

/** 빈칸 채우기. `{{정답}}` 구간이 빈칸이 된다. 객관적으로 자동 채점된다. */
export interface ClozeItem extends ItemBase {
  type: 'cloze'
  text: string // 예: "물의 화학식은 {{H2O}}이다"
}

/** 4지선다. 객관적으로 자동 채점된다. */
export interface McqItem extends ItemBase {
  type: 'mcq'
  prompt: string
  options: [string, string, string, string]
  correctIndex: 0 | 1 | 2 | 3
}

export interface CodeTest {
  args: unknown[] // JSON 직렬화 가능한 인자
  expected: unknown
}

/** 코드 실행 채점(Atlas DRL). `solve(...)` 함수를 정의하게 하고 테스트로 검증한다. */
export interface CodeItem extends ItemBase {
  type: 'code'
  prompt: string
  starterCode: string
  tests: CodeTest[]
}

export type Item = FlashcardItem | ClozeItem | McqItem | CodeItem
export type ItemType = Item['type']

// 일반 Omit<Item,K>는 유니온을 먼저 keyof로 뭉개버려서 flashcard의 front,
// mcq의 options 같은 타입별 필드가 전부 사라진다. `T extends any ? … : never`로
// 유니온을 분배한 뒤 각 멤버에 Omit을 적용해야 필드가 살아남는다.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/** db.addItem()의 입력 타입 — 타입별 필드는 유지한 채 id·createdAt만 뺀다. */
export type NewItem = DistributiveOmit<Item, 'id' | 'createdAt'>

/** 실제로 일어난 채점 사건 하나. append-only — 절대 수정·삭제하지 않는다. */
export interface Interaction {
  id: string
  itemId: string
  ts: string // ISO-8601, 채점이 일어난 시각
  grade: Grade
  confidence: Confidence | null // 응답 전 자신감. v0 데이터 호환을 위해 null 허용.
  errorTag: ErrorTag | null // again일 때만 값이 있을 수 있다. v1 데이터 호환을 위해 null 허용.
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

/**
 * 개인 로그로 재적합한 FSRS 파라미터(Atlas 3부·4부 Policy). 이것만 저장하고
 * CardState는 저장하지 않는다 — 스케줄러를 이걸로 바꿔 끼우면 과거 로그
 * 전체가 새 파라미터로 재계산된다(Atlas 4.2). 저장된 게 없으면 FSRS-6
 * 기본값(request_retention=0.9, default_w)을 쓴다.
 */
export interface SchedulerSettings {
  w: number[]
  requestRetention: number
  fittedAt: string
  testLossBefore: number
  testLossAfter: number
}
