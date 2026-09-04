// 카드 표시용 공통 헬퍼 — 활동 타입 이름표와 목록 한 줄 요약. CardsView와
// ItemForm이 같이 쓴다(예전엔 CardsView 안에만 있었다).

import type { Item, ItemType } from '../core/types'

export const TYPE_LABEL: Record<ItemType, string> = {
  flashcard: '플래시카드',
  cloze: '빈칸 채우기',
  mcq: '4지선다',
  code: '코드',
  short: '단답형',
}

export function itemSummary(item: Item): string {
  switch (item.type) {
    case 'flashcard':
      return item.front
    case 'cloze':
      return item.text.replace(/\{\{(.*?)\}\}/g, '_____')
    case 'mcq':
      return item.prompt
    case 'code':
      return item.prompt
    case 'short':
      return item.prompt
  }
}
