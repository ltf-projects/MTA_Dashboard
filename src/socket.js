import { io } from 'socket.io-client';

// Köprü sunucusunun adresi. Farklı bir makinede/portta çalışıyorsa
// .env üzerinden VITE_BRIDGE_URL tanımlayabilirsiniz.
export const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL || 'http://localhost:4001';

// Arayüz Vercel'de, köprü Railway'de çalışıyor: adres derleme anında gömülür.
// Prod derlemesinde değişken unutulursa arayüz localhost'a bağlanmaya çalışıp
// sessizce "bağlantı yok" durumunda kalır — konsolda sebebi açıkça yazsın.
if (import.meta.env.PROD && !import.meta.env.VITE_BRIDGE_URL) {
  console.error(
    '[ARAYÜZ] VITE_BRIDGE_URL tanımlı değil; köprü adresi localhost:4001 varsayıldı. ' +
      'Barındırma panelinde bu değişkeni köprünün genel adresiyle tanımlayıp yeniden derleyin.'
  );
}

export const socket = io(BRIDGE_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
});
