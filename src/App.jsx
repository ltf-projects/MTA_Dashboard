import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import Logo from './components/Logo.jsx';
import DataView from './components/DataView.jsx';
import LocationView from './components/LocationView.jsx';
import ThemePicker from './components/ThemePicker.jsx';

// Bu süre boyunca yeni paket gelmezse araç "Pasif" sayılır ve tüm değerler
// "Veri Yok" olarak gösterilir.
const STALE_MS = 15000;

//app
export default function App() {
  const [tab, setTab] = useState('veriler'); // 'veriler' | 'konum'
  const [conn, setConn] = useState({ connected: false, error: null });
  const [data, setData] = useState(null);
  const [analogData, setAnalogData] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
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
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connection-status', onStatus);
      socket.off('resData', onData);
      socket.off('resAnalogData', onAnalogData);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

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
