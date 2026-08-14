import { useMemo, useState } from 'react';
import { CATEGORIES, ZONE_LEGEND, fieldsOf } from '../config/fields.js';
import Gauge from './Gauge.jsx';
import StatCard from './StatCard.jsx';
import DigitalCard from './DigitalCard.jsx';
import HistoryView from './HistoryView.jsx';

// Canlı kategorilerin yanındaki geçmiş sekmesi. Diğerleri gelen paketi
// çizerken bu sekme köprüdeki /history ucundan kendi verisini çeker.
const HISTORY_ID = 'gecmis';

// Arama için metni normalleştirir: Türkçe büyük/küçük harf kuralları (I→ı,
// İ→i) uygulanır, ardından aksanlı harfler ASCII karşılığına indirgenir.
// Böylece "sicakl" yazınca "Sıcaklık", "yag" yazınca "Yağlama" da bulunur.
const TR_MAP = { ı: 'i', ğ: 'g', ü: 'u', ş: 's', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' };

function normalizeTr(text) {
  return String(text)
    .toLocaleLowerCase('tr')
    .replace(/[ığüşöçâîû]/g, (c) => TR_MAP[c] || c);
}

export default function DataView({
  packet,
  analogPacket,
  topic,
  boxId,
  stale = false,
  analogStale = false,
}) {
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0].id);
  const [search, setSearch] = useState('');

  const value = packet?.value;
  const resAnalogData = analogPacket?.value;
  const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  const hasAnalogData =
    resAnalogData !== null &&
    typeof resAnalogData === 'object' &&
    !Array.isArray(resAnalogData);

  const tabs = [...CATEGORIES, { id: HISTORY_ID, title: 'Geçmiş Grafik' }];
  const isHistory = activeCategory === HISTORY_ID;
  const isMachine = activeCategory === 'makine';
  const livePacket = isMachine ? analogPacket : packet;
  const receivedAt = livePacket?.receivedAt;
  const viewStale = isMachine ? analogStale : stale;

  const query = normalizeTr(search.trim());
  const matches = (key, tr) =>
    !query || normalizeTr(tr).includes(query) || normalizeTr(String(key)).includes(query);

  // Aktif sekmenin bölümleri: her biri arama sonrası boşsa gizlenir.
  const sections = useMemo(() => {
    const read = (key) => {
      if (!key) return undefined;
      if (activeCategory === 'makine') {
        return hasAnalogData ? resAnalogData[key] : undefined;
      }
      return isPlainObject ? value[key] : undefined;
    };
    const asNumber = (v) => (typeof v === 'number' ? v : v == null ? undefined : Number(v));

    const gaugeItems = (catId) =>
      fieldsOf(catId, 'gauge')
        .filter((f) => matches(f.key, f.tr))
        .map((f) => ({ ...f, current: asNumber(read(f.key)) }));

    if (activeCategory === 'makine') {
      return [{ kind: 'gauge', items: gaugeItems('makine') }];
    }
    if (activeCategory === 'motor') {
      return [
        {
          kind: 'stat',
          items: fieldsOf('motor', 'stat')
            .filter((f) => matches(f.key, f.tr))
            .map((f) => ({ ...f, current: asNumber(read(f.key)) })),
        },
        { kind: 'gauge', items: gaugeItems('motor') },
      ];
    }
    if (activeCategory === 'dijital') {
      return [
        { kind: 'gauge', items: gaugeItems('dijital') },
        {
          kind: 'digital',
          items: fieldsOf('dijital', 'digital')
            .filter((f) => matches(f.key, f.tr))
            .map((f) => ({ ...f, current: read(f.key) })),
        },
      ];
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, query, value, resAnalogData, isPlainObject, hasAnalogData]);

  const isEmpty = sections.every((s) => s.items.length === 0);

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h2 className="view-title">Sondaj Makinesi Verileri</h2>
          <p className={`view-sub ${viewStale ? 'view-sub--stale' : ''}`}>
            {!livePacket
              ? 'Araçtan henüz paket alınmadı'
              : viewStale
                ? `Veri akışı durdu — son paket: ${formatTime(receivedAt)}`
                : `Son güncelleme: ${formatTime(receivedAt)}`}
          </p>
        </div>
      </div>

      <div className="subtabs-row">
        <nav className="subtabs" role="tablist" aria-label="Veri kategorisi">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeCategory === t.id}
              className={`subtab ${activeCategory === t.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(t.id)}
            >
              {t.title}
            </button>
          ))}
        </nav>

        {/* Arama canlı kartları süzer; geçmiş sekmesinin kendi denetimleri var. */}
        {!isHistory && (
          <div className="search-box">
            <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <input
              type="text"
              className="search-input"
              placeholder="Veri ara..."
              aria-label="Verilerde ara"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="search-clear"
                aria-label="Aramayı temizle"
                onClick={() => setSearch('')}
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>

      {isHistory ? (
        <HistoryView />
      ) : !livePacket ? (
        <WaitingState topic={topic} boxId={boxId} />
      ) : isEmpty ? (
        <p className="empty">
          {query
            ? `“${search.trim()}” için sonuç bulunamadı.`
            : 'Bu kategoride gösterilecek veri yok.'}
        </p>
      ) : (
        sections.map((section, i) => {
          if (section.items.length === 0) return null;

          if (section.kind === 'stat') {
            return (
              <div className="stat-row" key={i}>
                {section.items.map((f) => (
                  <StatCard
                    key={f.key}
                    label={f.tr}
                    value={f.current}
                    unit={f.unit}
                    decimals={f.decimals}
                    icon={f.icon}
                    tone={f.tone}
                    stale={viewStale}
                  />
                ))}
              </div>
            );
          }

          if (section.kind === 'gauge') {
            return (
              <div key={i}>
                <ZoneLegend items={section.items} />
                <div className="gauge-grid">
                  {section.items.map((f) => (
                    <Gauge
                      key={f.tr}
                      label={f.tr}
                      value={f.current}
                      unit={f.unit}
                      min={f.min}
                      max={f.max}
                      zones={f.zones}
                      decimals={f.decimals}
                      tickDecimals={f.tickDecimals}
                      stale={viewStale}
                    />
                  ))}
                </div>
              </div>
            );
          }

          if (section.kind === 'digital') {
            return (
              <div className="digital-grid" key={i}>
                {section.items.map((f) => (
                  <DigitalCard key={f.key} label={f.tr} value={f.current} stale={viewStale} />
                ))}
              </div>
            );
          }

          return null;
        })
      )}
    </section>
  );
}

// Bölge renklerinin açıklaması. Her kartta tekrar etmek yerine gösterge
// ızgarasının üstünde bir kez gösterilir.
function ZoneLegend({ items }) {
  const levels = new Set(items.flatMap((f) => f.zones?.map((z) => z.level) ?? []));
  const shown = ZONE_LEGEND.filter((l) => levels.has(l.level));
  if (shown.length === 0) return null;

  return (
    <div className="zone-legend">
      {shown.map((l) => (
        <span className="zone-legend-item" key={l.level}>
          <i className={`zone-legend-dot zone-${l.level}`} />
          {l.label}
        </span>
      ))}
    </div>
  );
}

function WaitingState({ topic, boxId }) {
  return (
    <div className="waiting">
      <div className="spinner" />
      <h2>Veri bekleniyor</h2>
      <p>
        <code>{topic}</code> topic'inden <code>box_id: {boxId}</code> paketi
        bekleniyor. Köprü sunucusu broker'a bağlı olduğunda veriler burada
        anlık görünecek.
      </p>
    </div>
  );
}

// --- yardımcılar ---
function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('tr-TR');
  } catch {
    return iso;
  }
}
