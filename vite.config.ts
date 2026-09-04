/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // 대부분 순수 함수 테스트라 node 환경으로 충분하다. db.test.ts는
    // setup에서 fake-indexeddb를 전역에 깔아 IndexedDB 계층까지 검증한다.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
})
