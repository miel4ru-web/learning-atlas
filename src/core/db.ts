// IndexedDB 접근 계층. 두 개의 append-only에 가까운 스토어만 둔다:
// items(카드 정의)와 interactions(채점 로그). 둘 다 UPDATE는 없고, items는
// 편집을 허용하지만 interactions는 절대 수정하지 않는다(core/types.ts 주석 참고).

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Item, Interaction, Grade } from './types'

interface AtlasDB extends DBSchema {
  items: {
    key: string
    value: Item
  }
  interactions: {
    key: string
    value: Interaction
    indexes: { byItem: string }
  }
}

let dbPromise: Promise<IDBPDatabase<AtlasDB>> | null = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<AtlasDB>('learning-atlas', 1, {
      upgrade(db) {
        db.createObjectStore('items', { keyPath: 'id' })
        const interactions = db.createObjectStore('interactions', { keyPath: 'id' })
        interactions.createIndex('byItem', 'itemId')
      },
    })
  }
  return dbPromise
}

function newId(): string {
  return crypto.randomUUID()
}

export async function addItem(front: string, back: string): Promise<Item> {
  const item: Item = { id: newId(), front, back, createdAt: new Date().toISOString() }
  const db = await getDB()
  await db.add('items', item)
  return item
}

export async function getAllItems(): Promise<Item[]> {
  const db = await getDB()
  return db.getAll('items')
}

export async function deleteItem(itemId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['items', 'interactions'], 'readwrite')
  await tx.objectStore('items').delete(itemId)
  const idx = tx.objectStore('interactions').index('byItem')
  let cursor = await idx.openCursor(itemId)
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

export async function recordInteraction(itemId: string, grade: Grade): Promise<Interaction> {
  const interaction: Interaction = {
    id: newId(),
    itemId,
    ts: new Date().toISOString(),
    grade,
  }
  const db = await getDB()
  await db.add('interactions', interaction)
  return interaction
}

export async function getAllInteractions(): Promise<Interaction[]> {
  const db = await getDB()
  return db.getAll('interactions')
}

export async function getInteractionsForItem(itemId: string): Promise<Interaction[]> {
  const db = await getDB()
  return db.getAllFromIndex('interactions', 'byItem', itemId)
}

// 4부 검증 체크리스트: 로그를 지우고 재생해도 같은 스케줄이 나와야 한다.
// 이 함수는 그 주장을 실제로 시험할 수 있게 한다 — interactions만 지우고
// items는 남긴 뒤, 별도로 백업해 둔 로그를 replay 해 review_state가
// 동일하게 재구성되는지 확인하는 용도(개발자 콘솔에서 수동 호출).
export async function wipeInteractions(): Promise<void> {
  const db = await getDB()
  await db.clear('interactions')
}
