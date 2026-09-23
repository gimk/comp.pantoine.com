import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@xyflow')) {
            return 'flow';
          }
          if (id.includes('lucide-react')) {
            return 'lucide';
          }
        },
      },
    },
  },
});
