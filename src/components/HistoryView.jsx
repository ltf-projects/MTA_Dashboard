import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ApexCharts from 'apexcharts';
import { BRIDGE_URL } from '../socket.js';
import { bridgeFetch } from '../lib/api.js';
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
// burada renk "durum" değil "hangi alan" demektir. Palet, aynı grafikteki
// hiçbir seri aynı renge düşmeyecek ve komşu seriler kolay ayırt edilecek
// şekilde sıralanmıştır. Özellikle Rotasyon Tork (4. renk) güçlü fuşyadır.
const SERIES_COLORS = [
  '#0072B2', '#E69F00', '#009E73', '#E60049', '#56B4E9', '#D55E00',
  '#7A44A6', '#F0E442', '#00A6A6', '#CC79A7', '#4D7C0F', '#2563EB',
  '#C2410C', '#9333EA', '#15803D', '#DB2777', '#0891B2', '#A16207',
  '#4F46E5', '#DC2626', '#0F766E', '#7E22CE', '#65A30D', '#EA580C',
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
      const res = await bridgeFetch(url);
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
              divisor: f.divisor,
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
  const wrapRef = useRef(null);
  const hoverRef = useRef(null);
  const chartRef = useRef(null);
  const viewRef = useRef({ min: fromMs, max: toMs });
  const rangeRef = useRef({ fromMs, toMs });
  const mode = useThemeMode();
  const palette = useMemo(() => readPalette(), [mode]);

  // Yeni bir tarih aralığı yüklendiğinde görünüm sıfırlanır. Seri/tema gibi
  // diğer güncellemelerdeyse kullanıcının yakınlaştırdığı pencere korunur.
  if (rangeRef.current.fromMs !== fromMs || rangeRef.current.toMs !== toMs) {
    rangeRef.current = { fromMs, toMs };
    viewRef.current = { min: fromMs, max: toMs };
  }

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
        if (!Number.isFinite(t)) continue;
        if (prevT !== null && t - prevT > gapMs) data.push([prevT + 1, null]);
        const raw = row[s.key];
        const v = raw === null || raw === undefined ? NaN : Number(raw);
        // Bütün seriler aynı zaman noktalarını taşımalı. Aksi hâlde ApexCharts
        // ortak tooltip'i bir seriden diğerine geçerken kapatabiliyor. Eksik
        // ölçümü atlamak yerine null olarak tutarak zaman eksenini hizalıyoruz.
        data.push([
          t,
          Number.isFinite(v) ? (s.divisor ? v / s.divisor : v) : null,
        ]);
        prevT = t;
      }
      return { name: s.label, data };
    });
  }, [samples, series, gapMs]);

  const hasData = apexSeries.some((s) => s.data.some(([, value]) => value !== null));

  // İmleç katmanı (aşağıdaki efekt) yalnızca bir kez kurulur; o yüzden güncel
  // seriyi state yerine ref üzerinden okur. Her çizimde tazelenir.
  const hoverData = useRef([]);
  hoverData.current = series.map((s, i) => ({ ...s, points: apexSeries[i]?.data ?? [] }));

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
        events: {
          zoomed: (_chart, { xaxis }) => {
            if (Number.isFinite(xaxis?.min) && Number.isFinite(xaxis?.max)) {
              viewRef.current = { min: xaxis.min, max: xaxis.max };
            }
          },
          scrolled: (_chart, { xaxis }) => {
            if (Number.isFinite(xaxis?.min) && Number.isFinite(xaxis?.max)) {
              viewRef.current = { min: xaxis.min, max: xaxis.max };
            }
          },
          beforeResetZoom: () => {
            viewRef.current = { min: fromMs, max: toMs };
            return { xaxis: { min: fromMs, max: toMs } };
          },
        },
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
      // Nokta göstermek yoğun seride grafiği okunmaz yapıyor. İmlecin
      // yakaladığı noktayı kendi katmanımız işaretlediği için kütüphanenin
      // hover noktası da kapalı.
      markers: {
        size: 0,
        strokeWidth: 2,
        hover: { size: 0, sizeOffset: 0 },
      },
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
        crosshairs: { show: false },
        tooltip: { enabled: false },
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
      // Bilgi kutusunu, kılavuz çizgisini ve nokta işaretini kendimiz
      // çiziyoruz (bkz. imleç katmanı efekti). Kütüphaneninki kapalı çünkü:
      // yakaladığı serinin o andaki değeri null ise kutuyu tamamen gizliyor —
      // veri boşlukları ve eksik ölçümler yüzünden kutu sürekli kayboluyordu —
      // ve en yakın seriyi ararken null'ları eleyip dizinleri kaydırdığı için
      // imlecin üzerinde durmadığı bir çizgiyi gösterebiliyordu.
      tooltip: { enabled: false },
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
    const view = viewRef.current;
    chartRef.current?.updateOptions(
      {
        ...options,
        xaxis: { ...options.xaxis, min: view.min, max: view.max },
      },
      false,
      false
    );
  }, [options]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const chart = chartRef.current;
    const view = viewRef.current;
    chart?.updateSeries(apexSeries, false).then(() => chart.zoomX(view.min, view.max));
  }, [apexSeries]);

  // İmleç katmanı: fare grafiğin çizim alanındayken, imlece piksel olarak en
  // yakın NOKTA hangi seriye aitse yalnızca onun kutusu gösterilir. Kutu fare
  // çizim alanından çıkana kadar ekranda kalır; iki nokta arasında kalmak,
  // veri boşluğunun üzerinde durmak ya da başka bir serinin o anda eksik olması
  // kutuyu kapatmaz. Ölçek bilgisi (minX/maxX/minY/maxY) grafiğin kendisinden
  // okunur, böylece yakınlaştırma ve kaydırmadan sonra da doğru yeri gösterir.
  useEffect(() => {
    const wrap = wrapRef.current;
    const hover = hoverRef.current;
    if (!wrap || !hover) return undefined;

    const line = hover.querySelector('.chart-hover-line');
    const dot = hover.querySelector('.chart-hover-dot');
    const tip = hover.querySelector('.chart-tip');
    const tipTime = hover.querySelector('.chart-tip-time');
    const tipSwatch = hover.querySelector('.chart-tip-swatch');
    const tipLabel = hover.querySelector('.chart-tip-label');
    const tipValue = hover.querySelector('.chart-tip-value');

    const hide = () => hover.classList.remove('is-on');

    const onMove = (e) => {
      const g = chartRef.current?.w?.globals;
      const grid = wrap.querySelector('.apexcharts-grid');
      const cols = hoverData.current;
      if (!g || !grid || cols.length === 0) return hide();

      const gr = grid.getBoundingClientRect();
      const xSpan = g.maxX - g.minX;
      const ySpan = g.maxY - g.minY;
      if (!(gr.width > 0 && gr.height > 0 && xSpan > 0 && ySpan > 0)) return hide();

      // Fare konumu tam sayı, çizim alanının kenarları ise ondalıklı; kenarda
      // yarım piksellik bir taşma kutuyu kapatmasın diye küçük bir pay var.
      const edge = 2;
      const px = e.clientX - gr.left;
      const py = e.clientY - gr.top;
      if (px < -edge || py < -edge || px > gr.width + edge || py > gr.height + edge) return hide();

      const xPx = (t) => ((t - g.minX) / xSpan) * gr.width;
      const yPx = (v) => gr.height - ((v - g.minY) / ySpan) * gr.height;

      // İmlecin zamanına en yakın noktadan başlayıp her seride sağa ve sola
      // doğru ilk DOLU noktayı arıyoruz: boşluk için konan null noktalar
      // seçilmez, çizgisi o anda kopuk olan seri de yarışın dışında kalmaz.
      const hoverT = g.minX + (px / gr.width) * xSpan;
      let best = null;
      for (const col of cols) {
        const pts = col.points;
        if (pts.length === 0) continue;
        const k = nearestIndex(pts, hoverT);
        for (let step = -1; step <= 1; step += 2) {
          let i = step < 0 ? k : k + 1;
          while (i >= 0 && i < pts.length && pts[i][1] === null) i += step;
          if (i < 0 || i >= pts.length) continue;
          const [t, v] = pts[i];
          const d = Math.hypot(xPx(t) - px, yPx(v) - py);
          if (!best || d < best.d) best = { d, col, t, v };
        }
      }
      if (!best) return hide();

      const wr = wrap.getBoundingClientRect();
      const cx = gr.left - wr.left + xPx(best.t);
      const cy = gr.top - wr.top + yPx(best.v);
      line.style.transform = `translateX(${cx}px)`;
      line.style.top = `${gr.top - wr.top}px`;
      line.style.height = `${gr.height}px`;
      dot.style.transform = `translate(${cx}px, ${cy}px)`;
      dot.style.background = best.col.color;

      tipTime.textContent = formatTipStamp(best.t);
      tipSwatch.style.background = best.col.color;
      tipLabel.textContent = best.col.label;
      tipValue.textContent = `${formatNum(best.v, best.col.decimals ?? 2)}${
        best.col.unit ? ` ${best.col.unit}` : ''
      }`;
      hover.classList.add('is-on');

      // Kutu imleci takip eder; kenara dayanınca imlecin diğer yanına geçer.
      const gap = 16;
      let tx = e.clientX - wr.left + gap;
      let ty = e.clientY - wr.top + gap;
      if (tx + tip.offsetWidth > wr.width) tx = e.clientX - wr.left - tip.offsetWidth - gap;
      if (ty + tip.offsetHeight > wr.height) ty = e.clientY - wr.top - tip.offsetHeight - gap;
      tip.style.transform = `translate(${Math.max(tx, 0)}px, ${Math.max(ty, 0)}px)`;
      return undefined;
    };

    // Dokunmatikte parmak da imleç sayılır; onMove yalnızca clientX/clientY
    // okuduğu için Touch nesnesi doğrudan verilebiliyor.
    const onTouch = (e) => {
      const touch = e.touches?.[0];
      if (touch) onMove(touch);
    };

    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('mouseleave', hide);
    wrap.addEventListener('touchmove', onTouch, { passive: true });
    wrap.addEventListener('touchend', hide);
    return () => {
      wrap.removeEventListener('mousemove', onMove);
      wrap.removeEventListener('mouseleave', hide);
      wrap.removeEventListener('touchmove', onTouch);
      wrap.removeEventListener('touchend', hide);
    };
  }, []);

  // Araç çubuğundaki ev simgesiyle aynı işi yapar; kart başlığındaki düğme
  // yakınlaştırma/kaydırmadan sonra seçilen aralığa dönmenin görünür yolu.
  const resetView = () => {
    viewRef.current = { min: fromMs, max: toMs };
    chartRef.current?.zoomX(fromMs, toMs);
  };

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

      <div className="chart-plot" ref={wrapRef}>
        <div className="chart-plot-canvas" ref={hostRef} />

        {/* İmleç katmanı. İçerik ve konum yukarıdaki efektte doğrudan DOM
            üzerinden güncellenir; her fare hareketinde React çizimi tetiklemek
            gereksiz pahalı olurdu. */}
        <div className="chart-hover" ref={hoverRef} aria-hidden="true">
          <span className="chart-hover-line" />
          <span className="chart-hover-dot" />
          <div className="chart-tip">
            <div className="chart-tip-time" />
            <div className="chart-tip-row">
              <span className="chart-tip-swatch" />
              <span className="chart-tip-label" />
              <span className="chart-tip-value" />
            </div>
          </div>
        </div>
      </div>

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

// İmleç kutusundaki zaman. Saniye de yazılır: iki örnek arasındaki fark
// çoğu zaman saniyelerle ölçülür, dakika hassasiyeti ayırt etmeye yetmez.
function formatTipStamp(ms) {
  return new Date(ms).toLocaleString('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Zamanı verilen noktaya en yakın dizin. Noktalar zaman sırasında olduğu için
// ikili arama yeter; her fare hareketinde bütün seriler taranıyor.
function nearestIndex(pts, t) {
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(pts[lo - 1][0] - t) < Math.abs(pts[lo][0] - t)) return lo - 1;
  return lo;
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
