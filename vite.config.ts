/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// GitHub Pages 프로젝트 사이트로 배포한다(miel4ru-web.github.io/learning-atlas/)
// — 루트가 아니라 서브패스이므로 빌드에서만 base를 바꾼다. dev 서버는 계속
// localhost:5173/ 그대로 써야 하니 build일 때만 적용한다.
const BASE_PATH = '/learning-atlas/'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? BASE_PATH : '/',
  plugins: [
    react(),
    // PWA 설치 가능화 + 로컬 복습 알림(v28). injectManifest 전략을 쓰는 이유:
    // generateSW는 커스텀 코드(주기 동기화, 알림 클릭, IndexedDB 조회)를 넣을
    // 수 없다 — src/sw.ts를 직접 작성하고, 여기서 생성한 precache 목록만
    // 빌드 시 그 안에 주입받는다.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // 새 버전이 배포돼도 자동으로 활성화·새로고침하지 않는다 — 학습 세션
      // 도중 예고 없이 리로드되는 걸 피하기 위해서다(shell/UpdateBanner.tsx가
      // 사용자에게 물어본 뒤 activate한다).
      registerType: 'prompt',
      injectManifest: {
        swSrc: 'src/sw.ts',
        swDest: 'dist/sw.js',
      },
      manifest: {
        name: 'Learning Atlas',
        short_name: 'Atlas',
        description: '로컬 우선 간격 반복 학습 앱',
        // '.'은 매니페스트 파일 자신의 위치(=base) 기준 상대경로 — GitHub
        // Pages처럼 서브패스에 배포해도, 루트에 배포해도 그대로 맞는다.
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1f6f5c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // 개발 서버에서는 기본적으로 SW를 비활성화한다(핫 리로드와 충돌 방지) —
      // 실제 SW 동작 확인은 `npm run build && npm run preview`로 한다.
      devOptions: { enabled: false },
    }),
  ],
  test: {
    // 대부분 순수 함수 테스트라 node 환경으로 충분하다. db.test.ts는
    // setup에서 fake-indexeddb를 전역에 깔아 IndexedDB 계층까지 검증한다.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
}))
