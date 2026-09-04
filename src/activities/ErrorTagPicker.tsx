// again으로 채점된 직후에만 뜬다. 오답 원인(Atlas 2부 ERR)을 고르거나 건너뛴다.
// 네 활동 타입 모두가 이 컴포넌트를 공유한다 — 태그 체계는 활동 타입과 무관하다.

import type { ErrorTag } from '../core/types'

const TAGS: { tag: ErrorTag; label: string }[] = [
  { tag: 'concept', label: '개념 결손' },
  { tag: 'procedure', label: '절차 실수' },
  { tag: 'carelessness', label: '부주의' },
  { tag: 'time', label: '시간 부족' },
]

export function ErrorTagPicker({ onPick }: { onPick: (tag: ErrorTag | null) => void }) {
  return (
    <div className="error-tag-picker">
      <p className="muted">왜 틀렸나요? (선택)</p>
      <div className="error-tag-buttons">
        {TAGS.map(({ tag, label }) => (
          <button key={tag} onClick={() => onPick(tag)}>
            {label}
          </button>
        ))}
        <button className="skip" onClick={() => onPick(null)}>
          건너뛰기
        </button>
      </div>
    </div>
  )
}

export function errorTagLabel(tag: ErrorTag): string {
  return TAGS.find((t) => t.tag === tag)?.label ?? tag
}
