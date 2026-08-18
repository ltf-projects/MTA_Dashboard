import { useCallback, useEffect, useRef, useState } from 'react';
import { BRIDGE_URL } from '../socket.js';
import { Chart } from './HistoryView.jsx';
import RangePicker, {
  startOfToday,
  toLocalInput,
  validateRange,
} from './RangePicker.jsx';
import { ROTASYON_DEVIR_DIVISOR, ROTASYON_DEVIR_KEY } from '../config/fields.js';

// "Sondaj Makine Raporu" sekmesi. Üstte tarih aralığı seçimi, altında özet
// kartları.
//
// "Toplam Çalışma Saati" köprüdeki /report ucundan gelir; hesabın iki yolu ve
// hangisinin ne zaman seçildiği server.js'te anlatılır. Kayıt eksikse kartın
// altında uyarı çıkar: eksik veri sessizce "makine durmuş" gibi okunmasın.
//
// "Manevra Sayısı", makine verilerindeki Rotasyon Devir (AuxData1) serisinin
// çalışma bandına çıktığı ayrı blokların sayısıdır. Her bloğun başlangıç ve
// bitişi arasındaki sürelerin toplamı verimli çalışma, seçilen zamanın geri
// kalanı kayıp zaman olarak /report ucunda hesaplanır.

const ICONS = {
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  engine: (
    <>
      <path d="M4 10h2.5l2-2H12v-2h4v2h1.6l1.4 2H21v6h-1.5v3h-4.5l-2-2H8.5l-2 2H4z" />
      <path d="M9 6h4" />
    </>
  ),
  bolt: <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" />,
  swap: (
    <>
      <path d="M7 4v16M7 4 4 7.5M7 4l3 3.5" />
      <path d="M17 20V4m0 16 3-3.5M17 20l-3-3.5" />
    </>
  ),
  hourglass: (
    <>
      <path d="M7 3h10M7 21h10" />
      <path d="M8 3v3.5c0 2 4 3.6 4 5.5s-4 3.5-4 5.5V21" />
      <path d="M16 3v3.5c0 2-4 3.6-4 5.5s4 3.5 4 5.5V21" />
    </>
  ),
};

// Rapor grafiğinde alan seçici yoktur; bu iki seri her zaman birlikte çizilir.
const REPORT_SERIES = [
  {
    key: ROTASYON_DEVIR_KEY,
    label: 'Rotasyon Devir',
    unit: 'devir',
    decimals: 2,
    divisor: ROTASYON_DEVIR_DIVISOR,
    color: '#14b8a6',
  },
  {
    key: 'AnalogData7',
    label: 'Wireline Winç',
    unit: 'BAR',
    decimals: 2,
    color: '#fb923c',
  },
];

// Kartlarda "23 saat 59 dk" biçimi.
function splitDuration(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

export default function ReportView() {
  const [from, setFrom] = useState(() => toLocalInput(startOfToday()));
  const [to, setTo] = useState(() => toLocalInput(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [activeSeries, setActiveSeries] = useState(
    () => new Set(REPORT_SERIES.map((s) => s.key))
  );

  const load = useCallback(async () => {
    const { error: invalidMsg, fromMs, toMs } = validateRange(from, to, Date.now());
    if (invalidMsg) {
      setError(invalidMsg);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const fromIso = new Date(fromMs).toISOString();
      const toIso = new Date(toMs).toISOString();
      const reportUrl = new URL('/report', BRIDGE_URL);
      reportUrl.searchParams.set('from', fromIso);
      reportUrl.searchParams.set('to', toIso);
      const historyUrl = new URL('/history', BRIDGE_URL);
      historyUrl.searchParams.set('from', fromIso);
      historyUrl.searchParams.set('to', toIso);
      historyUrl.searchParams.set('keys', REPORT_SERIES.map((s) => s.key).join(','));

      const [reportRes, historyRes] = await Promise.all([
        fetch(reportUrl),
        fetch(historyUrl),
      ]);

      for (const res of [reportRes, historyRes]) {
        if (res.ok) continue;
        // Köprü sebebini yazıyorsa (veritabanı kapalı, bağlantı yok...) onu
        // olduğu gibi göster.
        let msg = `Sunucu ${res.status} döndü.`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch {
          /* gövde JSON değilse varsayılan mesaj kalsın */
        }
        throw new Error(msg);
      }

      const [report, history] = await Promise.all([reportRes.json(), historyRes.json()]);
      setResult({ ...report, history, fromMs, toMs });
    } catch (e) {
      setError(
        e instanceof TypeError
          ? 'Köprü sunucusuna ulaşılamıyor. Çalışıyor mu?'
          : e.message
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  // Sekme ilk açıldığında varsayılan aralık (bugün 00:00 → şimdi) hazır gelsin.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    load();
  }, [load]);

  const selectedMs = result ? result.toMs - result.fromMs : null;
  const selected = selectedMs === null ? null : splitDuration(selectedMs);

  // engineHours ondalık saat gelir (ör. 23.75).
  const engineMs =
    typeof result?.engineHours === 'number' ? result.engineHours * 3600000 : null;
  const engine = engineMs === null ? null : splitDuration(engineMs);
  const efficient =
    typeof result?.efficientHours === 'number'
      ? splitDuration(result.efficientHours * 3600000)
      : null;
  const lost =
    typeof result?.lostHours === 'number'
      ? splitDuration(result.lostHours * 3600000)
      : null;
  const usage =
    engineMs !== null && selectedMs > 0
      ? ((engineMs / selectedMs) * 100).toFixed(1)
      : null;

  // Kapsam açığı yalnızca anlamlı olduğunda söylenir; uçlardaki birkaç
  // saniyelik fark her raporda uyarı çıkarmasın.
  const missing = result?.coverage ? Math.round((1 - result.coverage.ratio) * 100) : null;
  const coverageWarn =
    result && result.sampleCount > 0 && missing >= 2
      ? `Aralığın %${missing}'inde kayıt yok`
      : null;

  const reportSeries = REPORT_SERIES.filter((s) => activeSeries.has(s.key));
  const chartKeysWithData = new Set(
    result?.history?.samples.flatMap((sample) =>
      REPORT_SERIES.filter((s) => sample[s.key] !== undefined).map((s) => s.key)
    ) ?? []
  );

  const toggleSeries = (key) =>
    setActiveSeries((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section className="history">
      <RangePicker
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onSubmit={load}
        loading={loading}
        title="Rapor almak istediğiniz tarih aralığını seçin"
      />

      {error && (
        <p className="history-error" role="alert">
          {error}
        </p>
      )}

      <div className="report-cards">
        <ReportCard
          tone="teal"
          icon="clock"
          label="Toplam Seçilen Zaman"
          hours={selected?.hours}
          minutes={selected?.minutes}
          note="Raporlama penceresi"
        />
        <ReportCard
          tone="green"
          icon="engine"
          label="Toplam Çalışma Saati"
          hours={engine?.hours}
          minutes={engine?.minutes}
          note={
            engine
              ? `%${usage} kullanım`
              : result
                ? 'Bu aralıkta kayıt yok'
                : 'Hesaplanıyor…'
          }
          warn={engine ? coverageWarn : null}
        />
        <ReportCard
          tone="blue"
          icon="bolt"
          label="Verimli Çalışma Saati"
          hours={efficient?.hours}
          minutes={efficient?.minutes}
          note="Aktif rotasyon süresi"
        />
        <ReportCard
          tone="amber"
          icon="hourglass"
          label="Verimsiz Zaman"
          hours={lost?.hours}
          minutes={lost?.minutes}
          note="Verimli çalışma dışındaki süre"
        />
        <ReportCard
          tone="purple"
          icon="swap"
          label="Manevra Sayısı"
          count={result?.maneuverCount}
          note="Rotasyon sayısı"
        />
      </div>

      {result?.history && (
        <div className="chart-card report-chart">
          <Chart
            title="Rotasyon Devri ve Wireline Winç"
            samples={result.history.samples}
            series={reportSeries}
            fromMs={result.fromMs}
            toMs={result.toMs}
            sampleMs={result.history.sampleMs}
            emptyHint="Grafikte göstermek için yukarıdan veri seçin."
            controls={
              <ReportSeriesPicker
                active={activeSeries}
                withData={chartKeysWithData}
                onToggle={toggleSeries}
              />
            }
          />
        </div>
      )}

      {result && (
        <section className="report-warnings" aria-labelledby="report-warnings-title">
          <div className="report-warnings-head">
            <span className="report-warnings-icon" aria-hidden="true">!</span>
            <h3 id="report-warnings-title">Uyarılar</h3>
          </div>
          {coverageWarn ? (
            <p className="report-warning-item">{coverageWarn}</p>
          ) : (
            <p className="report-warnings-empty">Seçilen tarih aralığında uyarı bulunmuyor.</p>
          )}
        </section>
      )}
    </section>
  );
}

function ReportSeriesPicker({ active, withData, onToggle }) {
  return (
    <div className="cats report-series-picker">
      <div className="cats-grid">
        {REPORT_SERIES.map((series) => {
          const on = active.has(series.key);
          const empty = !withData.has(series.key);
          return (
            <button
              key={series.key}
              type="button"
              className={`cat-chip ${on ? 'is-on' : ''} ${empty ? 'is-empty' : ''}`}
              style={{ '--series': series.color }}
              onClick={() => onToggle(series.key)}
              disabled={empty}
              aria-pressed={on}
              title={empty ? `${series.label} — bu aralıkta veri yok` : series.label}
            >
              <i className="cat-dot" aria-hidden="true" />
              <span className="cat-name">{series.label}</span>
              <span className="cat-sign" aria-hidden="true">{on ? '×' : '+'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReportCard({ tone, icon, label, hours, minutes, count, note, warn = null }) {
  const hasCount = typeof count === 'number';
  const hasDuration = typeof hours === 'number' && typeof minutes === 'number';

  return (
    <div className={`report-card report-card--${tone}`}>
      <span className="report-card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">{ICONS[icon]}</svg>
      </span>
      <span className="report-card-label">{label}</span>
      <span className="report-card-value">
        {hasCount ? (
          count
        ) : hasDuration ? (
          <>
            {/* Bir saatin altındaki süreler "0 saat 33 dk" diye yazılmasın. */}
            {hours > 0 && (
              <>
                {hours}
                <span className="report-card-unit"> saat </span>
              </>
            )}
            {minutes}
            <span className="report-card-unit"> dk</span>
          </>
        ) : (
          '—'
        )}
      </span>
      <span className="report-card-note">{note}</span>
      {warn && <span className="report-card-warn">{warn}</span>}
    </div>
  );
}
