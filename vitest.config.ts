import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Переиспользуем vite-конфиг (React-плагин, alias '@') + добавляем тест-окружение.
export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
}));
