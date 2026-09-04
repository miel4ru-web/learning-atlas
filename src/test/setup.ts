// vitest 전역 setup. IndexedDB를 fake 구현으로 깔아 db.ts(idb 래퍼)를 node에서
// 그대로 돌릴 수 있게 한다. 순수 함수 테스트에는 영향이 없다.
import 'fake-indexeddb/auto'
