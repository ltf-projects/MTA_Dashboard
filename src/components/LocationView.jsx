import MapView from './MapView.jsx';

// Konum sekmesi: Hoytek-IOT paketindeki Vehicle_Location_Lat / _Lon alanlarını
// Google Hybrid harita üzerinde canlı gösterir.
export default function LocationView({ packet, topic, boxId, stale = false }) {
  const coords = extractCoords(packet?.value);

  if (!packet) {
    return (
      <section className="view">
        <div className="waiting">
          <div className="spinner" />
          <h2>Konum bekleniyor</h2>
          <p>
            <code>{topic}</code> topic'inden <code>box_id: {boxId}</code> konum
            verisi bekleniyor.
          </p>
        </div>
      </section>
    );
  }

  const { receivedAt } = packet;

  return (
    <section className="view view-konum">
      <div className="location-layout">
        <div className="map-wrap">
          {coords ? (
            <>
              <MapView lat={coords.lat} lon={coords.lon} stale={stale} />

              <div className={`geo-indicator ${stale ? 'is-stale' : ''}`}>
                <div className="geo-live">
                  <span className="geo-live-dot" />
                  {stale ? 'VERİ YOK' : 'CANLI'}
                </div>
                <div className="geo-coords">
                  <div className="geo-coord">
                    <span className="geo-coord-label">ENLEM</span>
                    <span className="geo-coord-val">
                      {stale ? 'Veri Yok' : `${coords.lat.toFixed(6)}°`}
                    </span>
                  </div>
                  <div className="geo-coord">
                    <span className="geo-coord-label">BOYLAM</span>
                    <span className="geo-coord-val">
                      {stale ? 'Veri Yok' : `${coords.lon.toFixed(6)}°`}
                    </span>
                  </div>
                </div>
                <a
                  className="geo-link"
                  href={`https://www.google.com/maps?q=${coords.lat},${coords.lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Google Haritalar'da aç ↗
                </a>
              </div>
            </>
          ) : (
            <div className="map-empty">
              <p>Geçerli enlem/boylam bulunamadı.</p>
              <p className="hint">Cihazdan konum verisi bekleniyor.</p>
            </div>
          )}

          <aside className="location-fields">
            <div className="loc-row">
              <span className="loc-key">Cihaz No</span>
              <span className="loc-val">{boxId}</span>
            </div>
            <div className="loc-row">
              <span className="loc-key">Enlem</span>
              <span className={`loc-val ${stale ? 'is-empty' : ''}`}>
                {stale ? 'Veri Yok' : coords ? `${coords.lat.toFixed(8)}°` : '—'}
              </span>
            </div>
            <div className="loc-row">
              <span className="loc-key">Boylam</span>
              <span className={`loc-val ${stale ? 'is-empty' : ''}`}>
                {stale ? 'Veri Yok' : coords ? `${coords.lon.toFixed(8)}°` : '—'}
              </span>
            </div>
            <div className="loc-row">
              <span className="loc-key">{stale ? 'Son Paket' : 'Son Güncelleme'}</span>
              <span className="loc-val">{formatTime(receivedAt)}</span>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

// --- koordinat çıkarımı (Vehicle_Location_Lat / _Lon) ---
function extractCoords(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = Number(value.Vehicle_Location_Lat);
  const lon = Number(value.Vehicle_Location_Lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('tr-TR');
  } catch {
    return iso;
  }
}
