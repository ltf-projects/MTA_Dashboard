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

// autoConnect kapalı: bağlantı yalnızca oturum açıldıktan sonra, elde geçerli
// bir Supabase erişim jetonu varken kurulur. Köprü jetonu doğrulamadan hiçbir
// veri göndermez, yani giriş yapmayan kimse canlı veriyi göremez.
export const socket = io(BRIDGE_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  autoConnect: false,
});

// Jeton yenilendiğinde de çağrılır: socket.auth güncellenirse sonraki
// yeniden bağlanma denemesi taze jetonla yapılır.
export function connectSocket(accessToken) {
  socket.auth = { token: accessToken };
  if (!socket.connected) socket.connect();
}

export function disconnectSocket() {
  socket.auth = {};
  socket.disconnect();
}
