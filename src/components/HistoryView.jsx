import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ApexCharts from 'apexcharts';
import { BRIDGE_URL } from '../socket.js';
import { CATEGORIES, FIELDS } from '../config/fields.js';
import RangePicker, { startOfToday, toLocalInput, validateRange } from './RangePicker.jsx';

// "Geçmiş Grafik" sekmesi: köprüdeki /history ucundan seçilen tarih aralığını
// bir kez çeker, ardından grafiğin altındaki kategori çipleriyle hangi
// serilerin çizileceği seçilir. Çip açıp kapatmak yeniden istek atmaz —
// aralıktaki bütün alanlar zaten indirilmiştir.
//
// Geçmiş köprünün belleğinde tutulur (bkz. server.js). Köprü yeniden başlarsa
// veya tampon dolarsa eski örnekler kaybolur.

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

export default function HistoryView() {
  const [from, setFrom] = useState(() => toLocalInput(startOfToday()));
  const [to, setTo] = useState(() => toLocalInput(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [active, setActive] = useState(() => new Set());

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
      <RangePicker
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onSubmit={load}
        loading={loading}
      />

      {error && (
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

// Eksen DOĞRUSAL: değerler olduğu gibi çizilir, eksen üzerindeki eşit
// mesafeler eşit değer farkı demektir. Önceden logaritmik sıkıştırma vardı;
// küçük serileri görünür kılıyordu ama 0-1 arasıyla 10-100 arasını aynı
// mesafede gösterdiği için eksen yanıltıcıydı.
//
// Bunun bedeli: yüzlerle ölçülen basınçlarla birlerle ölçülen tork aynı
// grafikte açıkken küçük seriler tabana yakın kalır. Böyle bir durumda o
// serileri ayrı ayrı seçip incelemek gerekir.

// Eksen çizgilerinin oturacağı adım: aralığı yaklaşık 6 parçaya bölen, ama
// 1 / 2 / 2,5 / 5 ve bunların on katlarından biri olan değer. Ondalıklı bir
// adım (örn. 5,25) etiketleri okunmaz kıldığı için adım daima yuvarlaktır.
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(raw));
  const m = raw / base;
  const mult = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return mult * base;
}

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

export function Chart({
  title,
  samples,
  series,
  fromMs,
  toMs,
  sampleMs,
  controls = null,
  emptyHint = 'Grafiğe eklemek için aşağıdan veri seçin.',
}) {
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
        data.push([t, v]);
        prevT = t;
      }
      return { name: s.label, data };
    });
  }, [samples, series, gapMs]);

  const hasData = apexSeries.some((s) => s.data.length > 0);

  // Eksenin alt/üst sınırı ve kaç çizgi çizileceği. ApexCharts kendi başına
  // ölçeklerse durakları veri aralığını eşit bölerek seçiyor ve 2,16 / 30,6
  // gibi keyfi etiketler çıkabiliyor. Sınırları yuvarlak bir adımın katlarına
  // oturtunca duraklar da yuvarlak oluyor: 0 / 50 / 100 / 150 gibi.
  const yBounds = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of apexSeries) {
      for (const [, v] of s.data) {
        if (v === null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo)) return { min: 0, max: 100, tickAmount: 5 };

    // Tüm seriler sabit tek bir değerdeyse aralık sıfır olur; çizgi grafiğin
    // ortasında kalsın diye iki yana biraz pay bırakıyoruz.
    if (hi === lo) {
      const pad = Math.max(Math.abs(hi) * 0.1, 1);
      lo -= pad;
      hi += pad;
    }
    const step = niceStep((hi - lo) / 6);
    const min = Math.floor(lo / step) * step;
    const max = Math.ceil(hi / step) * step;
    return { min, max, tickAmount: Math.round((max - min) / step) };
  }, [apexSeries]);

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
        // Yakınlaştırınca eksen görünen veriye göre yeniden ölçeklenir;
        // doğrusal eksende küçük değerlere yakınlaşmanın tek yolu bu.
        // Yeni sınırların yine yuvarlak sayılara oturmasını forceNiceScale
        // sağlıyor (bkz. yaxis).
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
          text: 'Değer',
          style: { fontSize: '11px', fontWeight: 600, color: palette.axis },
        },
        min: yBounds.min,
        max: yBounds.max,
        tickAmount: yBounds.tickAmount,
        forceNiceScale: true,
        labels: {
          style: { fontSize: '11px', fontWeight: 600, colors: palette.axis },
          formatter: (v) => formatAxisValue(v),
        },
      },
      tooltip: {
        shared: false,
        intersect: false,
        theme: mode,
        x: { format: 'dd MMM HH:mm' },
        y: {
          formatter: (v, ctx) => {
            if (v === null || v === undefined) return '';
            const s = series[ctx?.seriesIndex] ?? {};
            return `${formatNum(v, s.decimals ?? 2)}${s.unit ? ` ${s.unit}` : ''}`;
          },
        },
      },
      noData: { text: '' },
    }),
    [series, fromMs, toMs, mode, palette, yBounds.min, yBounds.max, yBounds.tickAmount]
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

      {controls}

      <div className="chart-plot" ref={hostRef} />

      {series.length === 0 && (
        <p className="chart-hint">{emptyHint}</p>
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
