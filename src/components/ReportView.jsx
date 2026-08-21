import { useCallback, useEffect, useRef, useState } from 'react';
import { BRIDGE_URL } from '../socket.js';
import { bridgeFetch } from '../lib/api.js';
import { Chart } from './HistoryView.jsx';
import RangePicker, {
  startOfToday,
  toLocalInput,
  validateRange,
} from './RangePicker.jsx';
import { FIELDS, ROTASYON_DEVIR_DIVISOR, ROTASYON_DEVIR_KEY } from '../config/fields.js';

// "Sondaj Makine Raporu" sekmesi. Üstte tarih aralığı seçimi, altında özet
// kartları.
//
// "Toplam Çalışma Saati" köprüdeki /report ucundan gelir; hesabın iki yolu ve
// hangisinin ne zaman seçildiği server.js'te anlatılır.
//
// "Uyarılar" bölümündeki kritik olaylar saklanmaz; her raporda ham örneklerden
// hesaplanır. Boş liste ile "sorun yok" karıştırılmaz: aralıkta hiç kayıt yoksa
// ya da kayıt boşluğu varsa bunu ayrıca söyler — eksik veri sessizce "her şey
// yolunda" gibi okunmasın.
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
  before: (
    <>
      <path d="M4 12h13M8 7l-5 5 5 5" />
      <circle cx="18" cy="12" r="3" />
    </>
  ),
  after: (
    <>
      <path d="M7 12h13M16 7l5 5-5 5" />
      <circle cx="6" cy="12" r="3" />
    </>
  ),
  winch: (
    <>
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
      <path d="M7 12H3m14 0h4M5 8v8m14-8v8M12 7V3" />
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
    color: '#00A6A6',
  },
  {
    key: 'AnalogData7',
    label: 'Wireline Winç',
    unit: 'BAR',
    decimals: 2,
    color: '#7A44A6',
  },
];

const GAUGE_FIELDS = FIELDS.filter((field) => field.kind === 'gauge' && field.key);
const GAUGE_BY_KEY = new Map(GAUGE_FIELDS.map((field) => [field.key, field]));
const ALERTS_PER_PAGE = 10;

function formatAlertStamp(iso) {
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Uyarı tablosundaki sayılar: eşik ile ulaşılan değer aynı biçimde yazılır ki
// sütunlar alt alta karşılaştırılabilsin.
function formatAlertNumber(value, decimals, unit) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const text = value.toLocaleString('tr-TR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return unit ? `${text} ${unit}` : text;
}

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
  const [alertPage, setAlertPage] = useState(1);
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
      const alertsUrl = new URL('/report-alerts', BRIDGE_URL);
      alertsUrl.searchParams.set('from', fromIso);
      alertsUrl.searchParams.set('to', toIso);

      const [reportRes, historyRes, alertsRes] = await Promise.all([
        bridgeFetch(reportUrl),
        bridgeFetch(historyUrl),
        bridgeFetch(alertsUrl),
      ]);

      for (const res of [reportRes, historyRes, alertsRes]) {
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

      const [report, history, alertResult] = await Promise.all([
        reportRes.json(),
        historyRes.json(),
        alertsRes.json(),
      ]);
      setAlertPage(1);
      setResult({ ...report, history, alertResult, fromMs, toMs });
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
  const beforeOperation =
    typeof result?.beforeOperationHours === 'number'
      ? splitDuration(result.beforeOperationHours * 3600000)
      : null;
  const afterOperation =
    typeof result?.afterOperationHours === 'number'
      ? splitDuration(result.afterOperationHours * 3600000)
      : null;
  const usage =
    engineMs !== null && selectedMs > 0
      ? ((engineMs / selectedMs) * 100).toFixed(1)
      : null;

  // Aralıkta hiç örnek yoksa uyarı listesi de boş gelir; bu "sorun yok" değil
  // "bakılacak veri yok" demektir ve ayrıca söylenir.
  const noData = Boolean(result) && !(result.sampleCount > 0);
  // Kapsam açığı yalnızca anlamlı olduğunda söylenir; uçlardaki birkaç
  // saniyelik fark her raporda uyarı çıkarmasın.
  const missing = result?.coverage ? Math.round((1 - result.coverage.ratio) * 100) : null;
  const coverageWarn =
    result && result.sampleCount > 0 && missing >= 2
      ? `Aralığın %${missing}'inde kayıt yok`
      : null;
  const dangerAlerts = result?.alertResult?.alerts ?? [];
  const alertPageCount = Math.max(1, Math.ceil(dangerAlerts.length / ALERTS_PER_PAGE));
  const visibleAlerts = dangerAlerts.slice(
    (alertPage - 1) * ALERTS_PER_PAGE,
    alertPage * ALERTS_PER_PAGE
  );

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
        <ReportCard
          tone="violet"
          icon="winch"
          label="İç Tüp Çekme Operasyonu"
          count={result?.wirelinePeakCount}
          note="150 BAR ve üzerindeki ayrı tepe sayısı"
        />
        <ReportCard
          tone="cyan"
          icon="before"
          label="Operasyon Öncesi Süre"
          hours={beforeOperation?.hours}
          minutes={beforeOperation?.minutes}
          note="Manevra öncesi düşük rotasyon süresi"
        />
        <ReportCard
          tone="rose"
          icon="after"
          label="Operasyon Sonrası Süre"
          hours={afterOperation?.hours}
          minutes={afterOperation?.minutes}
          note="Manevra sonrası düşük rotasyon süresi"
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
          {noData && (
            <p className="report-warning-item">
              Seçilen aralıkta hiç kayıt yok; uyarı taraması yapılamadı.
            </p>
          )}
          {coverageWarn && <p className="report-warning-item">{coverageWarn}</p>}
          {dangerAlerts.length > 0 && (
            <>
              <div className="report-alert-table-wrap">
                <table className="report-alert-table">
                  <thead>
                    <tr>
                      <th>Gösterge</th>
                      <th>Tarih ve Saat</th>
                      <th className="report-alert-num">Kritik Eşik</th>
                      <th className="report-alert-num">Ulaşılan Değer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAlerts.map((alert, index) => {
                      const field = GAUGE_BY_KEY.get(alert.key);
                      const decimals = field?.decimals ?? 2;
                      return (
                        <tr key={`${alert.key}-${alert.t}-${index}`}>
                          <td><span className="report-alert-dot" aria-hidden="true" />{field?.tr ?? alert.key}</td>
                          <td><time dateTime={alert.t}>{formatAlertStamp(alert.t)}</time></td>
                          <td className="report-alert-threshold">
                            {formatAlertNumber(alert.threshold, decimals, field?.unit)}
                          </td>
                          <td className="report-alert-value">
                            {formatAlertNumber(alert.value, decimals, field?.unit)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="report-alert-pagination" aria-label="Uyarı sayfaları">
                <span>{dangerAlerts.length} kritik olay</span>
                <div>
                  <button
                    type="button"
                    onClick={() => setAlertPage((page) => Math.max(1, page - 1))}
                    disabled={alertPage === 1}
                  >
                    Önceki
                  </button>
                  <span>{alertPage} / {alertPageCount}</span>
                  <button
                    type="button"
                    onClick={() => setAlertPage((page) => Math.min(alertPageCount, page + 1))}
                    disabled={alertPage === alertPageCount}
                  >
                    Sonraki
                  </button>
                </div>
              </div>
            </>
          )}
          {result.alertResult?.truncated && (
            <p className="report-warning-item">İlk 1.000 kritik olay gösteriliyor.</p>
          )}
          {!noData && !coverageWarn && dangerAlerts.length === 0 && (
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

function ReportCard({ tone, icon, label, hours, minutes, count, note }) {
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
    </div>
  );
}
