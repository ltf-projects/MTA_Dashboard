import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ApexCharts from 'apexcharts';
import { BRIDGE_URL } from '../socket.js';
import { CATEGORIES, FIELDS } from '../config/fields.js';

// "Geçmiş Grafik" sekmesi: köprüdeki /history ucundan seçilen tarih aralığını
// bir kez çeker, ardından grafiğin altındaki kategori çipleriyle hangi
// serilerin çizileceği seçilir. Çip açıp kapatmak yeniden istek atmaz —
// aralıktaki bütün alanlar zaten indirilmiştir.
//
// Geçmiş köprünün belleğinde tutulur (bkz. server.js). Köprü yeniden başlarsa
// veya tampon dolarsa eski örnekler kaybolur.

const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

// Geçmiş bellekte tutulduğu için pratikte birkaç günden eskisi zaten yok;
// yine de kullanıcı 1970 ya da 2099 gibi anlamsız tarihler seçemesin diye
// seçilebilir pencere 30 günle sınırlanır. Üst sınır her zaman "şimdi"dir:
// gelecekte ölçüm olamaz.
const MAX_PAST_DAYS = 30;


// Girdi ve mesajlar için tek doğrulama noktası; hem "Göster" düğmesinin
// etkinliği hem de istek öncesi son kontrol buradan geçer.
function validateRange(fromStr, toStr, nowMs) {
  const fromMs = new Date(fromStr).getTime();
  const toMs = new Date(toStr).getTime();
  const floorMs = nowMs - MAX_PAST_DAYS * 24 * 60 * 60 * 1000;

  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { error: 'Tarihler eksik ya da geçersiz. Lütfen iki tarihi de seçin.' };
  }
  if (fromMs > nowMs || toMs > nowMs) {
    return { error: 'İleri bir tarih seçilemez — gelecekte ölçüm bulunmuyor.' };
  }
  if (fromMs < floorMs) {
    return { error: `En fazla ${MAX_PAST_DAYS} gün öncesine kadar seçebilirsiniz.` };
  }
  if (fromMs === toMs) {
    return { error: 'Başlangıç ile bitiş aynı olamaz.' };
  }
  if (fromMs > toMs) {
    return { error: 'Başlangıç, bitişten sonra olamaz.' };
  }
  if (toMs - fromMs > MAX_RANGE_MS) {
    return { error: 'En fazla 7 günlük aralık seçilebilir.' };
  }
  return { fromMs, toMs };
}

// Geçmiş yalnızca bu kategoriler için çizilir; her biri kendi grafiğini alır.
// Dijital alanlar açık/kapalı durum taşıdığı için zaman serisinde anlamlı
// değil, o yüzden dışarıda bırakıldı.
const CHART_CATEGORIES = ['makine', 'motor'];

// Grafiğe çizilebilecek alanlar: yukarıdaki kategorilerin sayısal alanları.
// Köprüden yalnızca bunlar istenir.
const CHARTABLE = FIELDS.filter((f) => f.key && CHART_CATEGORIES.includes(f.category));

// Seri renkleri. Bölge renklerinden (yeşil/sarı/kırmızı) ayrı tutulur, çünkü
// burada renk "durum" değil "hangi alan" demektir. İki temada da okunur.
const SERIES_COLORS = [
  '#4f9cf9', '#3ecf8e', '#f5a524', '#f5576c', '#a78bfa', '#22d3ee',
  '#fb923c', '#e879a9', '#84cc16', '#60a5fa', '#f43f5e', '#14b8a6',
];

const COLOR_OF = new Map(
  CHARTABLE.map((f, i) => [f.key, SERIES_COLORS[i % SERIES_COLORS.length]])
);

function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function HistoryView() {
  const [from, setFrom] = useState(() => toLocalInput(startOfToday()));
  const [to, setTo] = useState(() => toLocalInput(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [active, setActive] = useState(() => new Set());

  // Üst sınır ("şimdi") ilerlesin diye dakikada bir tazelenir; yoksa sayfa
  // uzun süre açık kalınca son dakikalar seçilemez hale gelirdi.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const check = validateRange(from, to, nowMs);
  const invalid = Boolean(check.error);

  // Tarayıcının kendi seçicisi de anlamsız tarihleri baştan engellesin.
  const minInput = toLocalInput(new Date(nowMs - MAX_PAST_DAYS * 24 * 60 * 60 * 1000));
  const maxInput = toLocalInput(new Date(nowMs));

  const load = useCallback(async () => {
    const { error: invalidMsg, fromMs, toMs } = validateRange(from, to, Date.now());
    if (invalidMsg) {
      setError(invalidMsg);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const url = new URL('/history', BRIDGE_URL);
      url.searchParams.set('from', new Date(fromMs).toISOString());
      url.searchParams.set('to', new Date(toMs).toISOString());
      url.searchParams.set('keys', CHARTABLE.map((f) => f.key).join(','));
      const res = await fetch(url);
      if (!res.ok) {
        // Köprü hatayı açıklıyorsa (veritabanı kapalı, bağlantı yok...) onu
        // olduğu gibi göster; genel bir mesajla üstünü örtme.
        let msg = `Sunucu ${res.status} döndü.`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch {
          /* gövde JSON değilse varsayılan mesaj kalsın */
        }
        throw new Error(msg);
      }
      const json = await res.json();
      setResult({ ...json, fromMs, toMs });
    } catch (e) {
      // fetch'in kendisi patlarsa (ağ/CORS) TypeError gelir — bu durumda
      // köprüye hiç ulaşılamamıştır.
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

  // Sekme ilk açıldığında aralık hazır gelsin.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    load();
  }, [load]);

  const toggle = (key) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Yalnızca bu aralıkta gerçekten değeri olan alanlar açılabilir olsun.
  const withData = useMemo(() => {
    if (!result) return new Set();
    const seen = new Set();
    for (const s of result.samples) {
      for (const k of Object.keys(s)) if (k !== 't') seen.add(k);
    }
    return seen;
  }, [result]);

  // Her kategori kendi grafiğini çizer. Bir alan yalnızca tek bir kategoriye
  // ait olduğu için tek bir `active` kümesi hepsine yetiyor: her grafik
  // kümenin yalnızca kendi alanlarına düşen kısmını çizer.
  const groups = useMemo(
    () =>
      CATEGORIES.filter((c) => CHART_CATEGORIES.includes(c.id)).map((c) => {
        const fields = CHARTABLE.filter((f) => f.category === c.id);
        return {
          ...c,
          fields,
          series: fields
            .filter((f) => active.has(f.key))
            .map((f) => ({
              key: f.key,
              label: f.tr,
              unit: f.unit,
              decimals: f.decimals ?? 2,
              color: COLOR_OF.get(f.key),
            })),
        };
      }).filter((g) => g.fields.length > 0),
    [active]
  );

  // Bir kategorinin tüm alanlarını birlikte açar/kapatır. Açarken bu aralıkta
  // verisi olmayan alanlar atlanır — çipleri zaten devre dışı.
  const setGroup = (fields, on) =>
    setActive((prev) => {
      const next = new Set(prev);
      for (const f of fields) {
        if (!on) next.delete(f.key);
        else if (withData.has(f.key)) next.add(f.key);
      }
      return next;
    });

  return (
    <section className="history">
      <div className="history-panel">
        <p className="history-panel-title">Görmek istediğiniz tarih aralığını seçin</p>
        <p className="history-panel-note">En fazla 7 günlük aralık seçilebilir</p>

        <div className="history-controls">
          <label className="history-field">
            <span className="history-field-label">Başlangıç</span>
            <input
              type="datetime-local"
              value={from}
              min={minInput}
              max={maxInput}
              aria-invalid={invalid}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>

          <span className="history-arrow" aria-hidden="true">
            →
          </span>

          <label className="history-field">
            <span className="history-field-label">Bitiş</span>
            <input
              type="datetime-local"
              value={to}
              min={minInput}
              max={maxInput}
              aria-invalid={invalid}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>

        {/* Seçim bozuksa istek atılmadan, anında söylenir. */}
        {invalid && (
          <p className="history-warn" role="alert">
            {check.error}
          </p>
        )}

        <button
          type="button"
          className="history-run"
          onClick={load}
          disabled={loading || invalid}
          title={invalid ? check.error : 'Seçilen aralığı getir'}
        >
          {loading ? 'Yükleniyor…' : 'Göster'}
        </button>
      </div>

      {error && !invalid && (
        <p className="history-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <>
          {result.samples.length === 0 && (
            <p className="history-warn">
              {result.available
                ? `Bu aralıkta kayıtlı veri yok. Köprünün elindeki geçmiş ${formatStamp(
                    Date.parse(result.available.from)
                  )} – ${formatStamp(Date.parse(result.available.to))} arası.`
                : 'Köprü henüz hiç örnek biriktirmedi. Geçmiş, köprü çalışmaya başladığı andan itibaren tutulur.'}
            </p>
          )}

          {groups.map((g) => (
            <div className="chart-card" key={g.id}>
              <Chart
                title={g.title}
                samples={result.samples}
                series={g.series}
                fromMs={result.fromMs}
                toMs={result.toMs}
                sampleMs={result.sampleMs}
              />

              <FieldPicker
                fields={g.fields}
                active={active}
                withData={withData}
                onToggle={toggle}
                onAll={() => setGroup(g.fields, true)}
                onNone={() => setGroup(g.fields, false)}
              />
            </div>
          ))}
        </>
      )}
    </section>
  );
}

// --- Alan seçici (her grafiğin altında, yalnızca o kategorinin alanları) ----
function FieldPicker({ fields, active, withData, onToggle, onAll, onNone }) {
  const onCount = fields.filter((f) => active.has(f.key)).length;
  const selectable = fields.filter((f) => withData.has(f.key)).length;

  return (
    <div className="cats">
      <div className="cats-head">
        <span className="cats-title">
          Alanlar — {onCount}/{fields.length} açık
        </span>
        <div className="cats-actions">
          <button type="button" className="cats-btn" onClick={onAll} disabled={selectable === 0}>
            Tümünü aç
          </button>
          <button type="button" className="cats-btn" onClick={onNone} disabled={onCount === 0}>
            Tümünü kapat
          </button>
        </div>
      </div>

      <div className="cats-grid">
        {fields.map((f) => {
          const on = active.has(f.key);
          const empty = !withData.has(f.key);
          return (
            <button
              key={f.key}
              type="button"
              className={`cat-chip ${on ? 'is-on' : ''} ${empty ? 'is-empty' : ''}`}
              style={{ '--series': COLOR_OF.get(f.key) }}
              onClick={() => onToggle(f.key)}
              disabled={empty}
              aria-pressed={on}
              title={empty ? `${f.tr} — bu aralıkta veri yok` : f.tr}
            >
              <i className="cat-dot" aria-hidden="true" />
              <span className="cat-name">{f.tr}</span>
              <span className="cat-sign" aria-hidden="true">
                {on ? '×' : '+'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Grafik ---------------------------------------------------------------
// Çizim ApexCharts ile yapılır: yakınlaştırma/kaydırma araç çubuğu, imleç
// kılavuzu, imleç kutucuğu ve dışa aktarma menüsü kütüphaneden hazır gelir.
// Grafiğin kendisi dışındaki her şey (alan seçici, tarih paneli) değişmedi.

// Alanların büyüklükleri arasında birkaç kat fark var: bar basıncı yüzlerle,
// tork ise birlerle ölçülüyor. Doğrusal eksende küçük seriler tabana yapışıp
// okunmaz hale geliyordu, bu yüzden eksen SİMETRİK LOGARİTMİK: değerler
// log10(1 + |v|) ile sıkıştırılır, işaret korunur. Böylece 0 ve negatif
// değerler de çizilebilir (düz logaritma bunları çizemez).
//
// Eksen etiketleri ve imleç kutucuğu her zaman ters dönüşümle gerçek değeri
// gösterir; sıkıştırma yalnızca çizim içindir.
const symlog = (v) => Math.sign(v) * Math.log10(1 + Math.abs(v));
const symexp = (u) => Math.sign(u) * (10 ** Math.abs(u) - 1);

// Araç çubuğu ipuçları ve tarih adları Türkçe olsun diye ApexCharts'a kendi
// yerelimizi veriyoruz; kütüphane varsayılan olarak yalnızca İngilizce gelir.
const TR_LOCALE = {
  name: 'tr',
  options: {
    months: [
      'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
      'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
    ],
    shortMonths: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
    days: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
    shortDays: ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'],
    toolbar: {
      exportToSVG: 'SVG indir',
      exportToPNG: 'PNG indir',
      exportToCSV: 'CSV indir',
      menu: 'Menü',
      selection: 'Seçim',
      selectionZoom: 'Seçerek yakınlaştır',
      zoomIn: 'Yakınlaştır',
      zoomOut: 'Uzaklaştır',
      pan: 'Kaydır',
      reset: 'Görünümü sıfırla',
    },
  },
};

// ApexCharts somut renk ister; arayüzün renkleri ise CSS değişkenlerinde.
// Tema değişince değişkenler yeniden hesaplanır, burada okunan değerler de
// bu yüzden tema anahtarına bağlı yenilenir.
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const val = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    axis: val('--text-faint', '#8593a3'),
    grid: val('--neutral-line', 'rgba(255, 255, 255, 0.16)'),
  };
}

// <html data-theme> özniteliğini izler; tema düğmesiyle palet değişince
// grafiğin renkleri de sayfa yenilenmeden birlikte değişsin diye.
function useThemeMode() {
  const read = () =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const [mode, setMode] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setMode(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return mode;
}

function Chart({ title, samples, series, fromMs, toMs, sampleMs }) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const mode = useThemeMode();
  const palette = useMemo(() => readPalette(), [mode]);

  // Çizginin nerede kopacağını belirleyen eşik. Köprü aralığı ~1200 noktaya
  // seyrelttiği için ardışık örnekler arasındaki mesafe, ham örnekleme
  // aralığından (sampleMs, 5 sn) çok daha büyük olabilir: bir günlük aralıkta
  // yaklaşık bir dakika. Eşik sampleMs'ten türetilseydi çizgi neredeyse her
  // noktada kopar, grafik çizgi yerine nokta bulutuna dönerdi.
  //
  // Bu yüzden eşik gelen örneklerin GERÇEK aralığından hesaplanır. Ortalama
  // yerine medyan alınır: tek tük kesintiler medyanı kaydırmaz, dolayısıyla
  // gerçek veri boşlukları hâlâ kopuk görünür.
  const gapMs = useMemo(() => {
    const deltas = [];
    for (let i = 1; i < samples.length; i += 1) {
      const d = Date.parse(samples[i].t) - Date.parse(samples[i - 1].t);
      if (Number.isFinite(d) && d > 0) deltas.push(d);
    }
    const floor = Math.max((sampleMs || 10000) * 3, 30000);
    if (deltas.length === 0) return floor;
    deltas.sort((a, b) => a - b);
    return Math.max(deltas[deltas.length >> 1] * 4, floor);
  }, [samples, sampleMs]);

  // Seriler ApexCharts'ın beklediği [zaman, değer] çiftlerine çevrilir.
  // Veri akışının kesildiği yere null bir nokta konur; kütüphane orada
  // çizgiyi koparır, iki uç noktayı yanlışlıkla birleştirmez.
  const apexSeries = useMemo(() => {
    return series.map((s) => {
      const data = [];
      let prevT = null;
      for (const row of samples) {
        const t = Date.parse(row.t);
        const v = Number(row[s.key]);
        if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
        if (prevT !== null && t - prevT > gapMs) data.push([prevT + 1, null]);
        data.push([t, symlog(v)]);
        prevT = t;
      }
      return { name: s.label, data };
    });
  }, [samples, series, gapMs]);

  const hasData = apexSeries.some((s) => s.data.length > 0);

  const options = useMemo(
    () => ({
      chart: {
        type: 'line',
        height: 400,
        fontFamily: 'inherit',
        background: 'transparent',
        foreColor: palette.axis,
        locales: [TR_LOCALE],
        defaultLocale: 'tr',
        animations: { enabled: false },
        zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
        toolbar: {
          show: true,
          autoSelected: 'zoom',
          tools: {
            download: true,
            selection: false,
            zoom: true,
            zoomin: true,
            zoomout: true,
            pan: true,
            reset: true,
          },
        },
      },
      theme: { mode },
      colors: series.map((s) => s.color),
      stroke: { curve: 'straight', width: 2 },
      // Nokta göstermek yoğun seride grafiği okunmaz yapıyor; yalnızca
      // imleç bir seriye değdiğinde o noktayı büyütüyoruz.
      markers: { size: 0, hover: { size: 4 } },
      dataLabels: { enabled: false },
      legend: { show: false },
      grid: {
        borderColor: palette.grid,
        strokeDashArray: 4,
        xaxis: { lines: { show: false } },
        yaxis: { lines: { show: true } },
        padding: { top: 0, right: 16, bottom: 0, left: 8 },
      },
      xaxis: {
        type: 'datetime',
        min: fromMs,
        max: toMs,
        axisBorder: { show: false },
        axisTicks: { color: palette.grid },
        labels: {
          datetimeUTC: false,
          style: { fontSize: '11px', fontWeight: 600, colors: palette.axis },
        },
        crosshairs: { stroke: { color: palette.axis, width: 1, dashArray: 4 } },
        tooltip: { enabled: true },
      },
      yaxis: {
        title: {
          text: 'Değer (log)',
          style: { fontSize: '11px', fontWeight: 600, color: palette.axis },
        },
        tickAmount: 6,
        labels: {
          style: { fontSize: '11px', fontWeight: 600, colors: palette.axis },
          formatter: (u) => formatAxisValue(symexp(u)),
        },
      },
      tooltip: {
        shared: false,
        intersect: false,
        theme: mode,
        x: { format: 'dd MMM HH:mm' },
        y: {
          formatter: (u, ctx) => {
            if (u === null || u === undefined) return '';
            const s = series[ctx?.seriesIndex] ?? {};
            return `${formatNum(symexp(u), s.decimals ?? 2)}${s.unit ? ` ${s.unit}` : ''}`;
          },
        },
      },
      noData: { text: '' },
    }),
    [series, fromMs, toMs, mode, palette]
  );

  // Grafik bir kez kurulur; sonraki değişiklikler yeniden kurmadan
  // güncellenir, böylece yakınlaştırma her seçimde sıfırlanmaz.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const seriesRef = useRef(apexSeries);
  seriesRef.current = apexSeries;

  useEffect(() => {
    const chart = new ApexCharts(hostRef.current, {
      ...optionsRef.current,
      series: seriesRef.current,
    });
    chartRef.current = chart;
    chart.render();
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, []);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) return;
    chartRef.current?.updateOptions(options, false, false);
  }, [options]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    chartRef.current?.updateSeries(apexSeries, false);
  }, [apexSeries]);

  // Araç çubuğundaki ev simgesiyle aynı işi yapar; kart başlığındaki düğme
  // yakınlaştırma/kaydırmadan sonra seçilen aralığa dönmenin görünür yolu.
  const resetView = () => chartRef.current?.zoomX(fromMs, toMs);

  return (
    <>
      <div className="chart-card-head">
        <span className="chart-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <path d="M7 15l3.5-4 2.5 2.5L17 9" />
          </svg>
        </span>
        <h3 className="chart-card-title">{title}</h3>
        <button type="button" className="chart-reset" onClick={resetView} disabled={!hasData}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20l-3.6-3.6" />
          </svg>
          Görünümü sıfırla
        </button>
      </div>

      <div className="chart-plot" ref={hostRef} />

      {series.length === 0 && (
        <p className="chart-hint">Grafiğe eklemek için aşağıdan veri seçin.</p>
      )}
      {series.length > 0 && !hasData && (
        <p className="chart-hint">Seçilen veriler bu aralıkta kayıtlı değil.</p>
      )}
    </>
  );
}

// --- yardımcılar ---
function formatNum(v, decimals = 2) {
  return v.toLocaleString('tr-TR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatStamp(ms) {
  return new Date(ms).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Değer ekseni etiketi. Basamak sayısı büyüklüğe göre kısalır: 549 tam sayı
// yazılır, 0,77 iki hane ister. Sondaki sıfırlar atılır (4,60 değil 4,6).
function formatAxisValue(v) {
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString('tr-TR', { maximumFractionDigits: decimals });
}
