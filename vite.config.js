import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // DTS Demo 5173'te çalıştığı için çakışmaması adına 5174.
    port: 5174,
    host: true,
  },
});
