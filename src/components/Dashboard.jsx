import { useEffect, useState } from 'react';
import { socket, connectSocket, disconnectSocket } from '../socket.js';
import { supabase } from '../lib/supabase.js';
import Logo from './Logo.jsx';
import DataView from './DataView.jsx';
import LocationView from './LocationView.jsx';
import ThemePicker from './ThemePicker.jsx';

// Bu süre boyunca yeni paket gelmezse araç "Pasif" sayılır ve tüm değerler
// "Veri Yok" olarak gösterilir.
const STALE_MS = 15000;

// Panelin tamamı. Yalnızca App oturumu doğruladıktan sonra takılır; bu yüzden
// buradaki hiçbir etki (socket bağlantısı dahil) giriş yapılmadan çalışmaz.
export default function Dashboard({ session }) {
  const [tab, setTab] = useState('veriler'); // 'veriler' | 'konum'
  const [conn, setConn] = useState({ connected: false, error: null });
  const [data, setData] = useState(null);
  const [analogData, setAnalogData] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const accessToken = session?.access_token;

  // Köprüye bağlan. Jeton yenilendiğinde (Supabase saatte bir yeniler) bu etki
  // yeniden çalışır ve bağlantı taze jetonla kurulur.
  useEffect(() => {
    if (!accessToken) return;

    const onStatus = (s) => setConn(s);
    const onData = (pkt) => setData(pkt);
    const onAnalogData = (pkt) => setAnalogData(pkt);

    socket.on('connection-status', onStatus);
    socket.on('resData', onData);
    socket.on('resAnalogData', onAnalogData);

    // Köprü sunucusuna (Socket.IO) bağlantı durumu
    const onConnect = () => setConn((c) => ({ ...c }));
    const onDisconnect = () =>
      setConn({ connected: false, error: 'Köprü sunucusuna bağlanılamıyor' });
    // Köprü jetonu reddederse (süresi dolmuş/geçersiz) sebebi görünsün.
    const onConnectError = (err) =>
      setConn({ connected: false, error: err?.message || 'Köprüye bağlanılamadı' });

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    connectSocket(accessToken);

    return () => {
      socket.off('connection-status', onStatus);
      socket.off('resData', onData);
      socket.off('resAnalogData', onAnalogData);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      disconnectSocket();
    };
  }, [accessToken]);

  // Veri akışının durduğunu fark edebilmek için saniyede bir tetiklenen sayaç.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const lastAt = data?.receivedAt ? new Date(data.receivedAt).getTime() : null;
  const secondsSince = lastAt ? Math.floor((now - lastAt) / 1000) : null;
  // Paket hiç gelmediyse veya 15 sn'dir gelmiyorsa veriler bayat sayılır.
  const stale = lastAt === null || now - lastAt > STALE_MS;
  const analogLastAt = analogData?.receivedAt
    ? new Date(analogData.receivedAt).getTime()
    : null;
  const analogStale = analogLastAt === null || now - analogLastAt > STALE_MS;
  const deviceActive = conn.connected && !stale;

  const boxId = conn.boxId ?? 20;
  const topic = conn.topic || 'Hoytek-IOT/';

  // Oturumu kapat. onAuthStateChange App'i uyarır, App giriş ekranına döner.
  const signOut = () => supabase?.auth.signOut();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span className="brand-sep" aria-hidden="true" />
          <span className="device-badge" title="Görüntülenen cihaz">
            Cihaz <b>#{boxId}</b>
          </span>
        </div>

        <nav className="tabs" role="tablist" aria-label="Görünüm seçimi">
          <button
            role="tab"
            aria-selected={tab === 'veriler'}
            className={`tab ${tab === 'veriler' ? 'active' : ''}`}
            onClick={() => setTab('veriler')}
          >
            Veriler
          </button>
          <button
            role="tab"
            aria-selected={tab === 'konum'}
            className={`tab ${tab === 'konum' ? 'active' : ''}`}
            onClick={() => setTab('konum')}
          >
            Konum
          </button>
        </nav>

        <div className="status-cluster">
          <div
            className={`status-pill ${deviceActive ? 'ok' : 'off'}`}
            aria-label={`Araç durumu: ${deviceActive ? 'Aktif' : 'Pasif'}`}
            title={
              conn.error ||
              (deviceActive
                ? 'Araç veri gönderiyor'
                : stale && conn.connected
                  ? `Son ${secondsSince ?? '—'} saniyedir veri gelmiyor`
                  : 'Broker bağlantısı yok')
            }
          >
            <span className="dot" aria-hidden="true" />
            <span className="status-text">{deviceActive ? 'Aktif' : 'Pasif'}</span>
          </div>

          <ThemePicker />

          <button
            type="button"
            className="signout-btn"
            onClick={signOut}
            title={session?.user?.email || 'Oturumu kapat'}
          >
            <SignOutIcon />
            <span className="signout-text">Çıkış</span>
          </button>
        </div>
      </header>

      <main className="content">
        {tab === 'veriler' ? (
          <DataView
            packet={data}
            analogPacket={analogData}
            topic={topic}
            boxId={boxId}
            stale={stale}
            analogStale={analogStale}
          />
        ) : (
          <LocationView packet={data} topic={topic} boxId={boxId} stale={stale} />
        )}
      </main>

      <footer className="footer">
        <span>MTA Dashboard · Canlı MQTT İzleme</span>
        {conn.broker && <span className="footer-broker">{conn.broker}</span>}
      </footer>
    </div>
  );
}

function SignOutIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14" />
      <path d="M9.5 8.5 5.5 12l4 3.5" />
      <path d="M6 12h8.5" />
    </svg>
  );
}
