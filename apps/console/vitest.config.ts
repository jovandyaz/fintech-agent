import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [react()],
  test: {
    name: 'console',
    environment: 'jsdom',
    css: true,
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
