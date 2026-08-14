import { io } from 'socket.io-client';

// Köprü sunucusunun adresi. Farklı bir makinede/portta çalışıyorsa
// .env üzerinden VITE_BRIDGE_URL tanımlayabilirsiniz.
export const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL || 'http://localhost:4001';

export const socket = io(BRIDGE_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
});
