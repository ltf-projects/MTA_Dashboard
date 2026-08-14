import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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

// Grafiğe çizilebilecek alanlar: tanımlı her sayısal alan.
const CHARTABLE = FIELDS.filter((f) => f.key);

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

  const series = useMemo(
    () =>
      CHARTABLE.filter((f) => active.has(f.key)).map((f) => ({
        key: f.key,
        label: f.tr,
        unit: f.unit,
        decimals: f.decimals ?? 2,
        color: COLOR_OF.get(f.key),
      })),
    [active]
  );

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

          <div className="chart-card">
            <Chart
              samples={result.samples}
              series={series}
              fromMs={result.fromMs}
              toMs={result.toMs}
              sampleMs={result.sampleMs}
            />

            <CategoryPicker
              active={active}
              withData={withData}
              onToggle={toggle}
              onAll={() => setActive(new Set(CHARTABLE.filter((f) => withData.has(f.key)).map((f) => f.key)))}
              onNone={() => setActive(new Set())}
            />
          </div>
        </>
      )}
    </section>
  );
}

// --- Kategori seçici -------------------------------------------------------
function CategoryPicker({ active, withData, onToggle, onAll, onNone }) {
  const total = CHARTABLE.length;

  return (
    <div className="cats">
      <div className="cats-head">
        <span className="cats-title">
          Kategoriler — {active.size}/{total} açık
        </span>
        <div className="cats-actions">
          <button type="button" className="cats-btn" onClick={onAll} disabled={withData.size === 0}>
            Tümünü aç
          </button>
          <button type="button" className="cats-btn" onClick={onNone} disabled={active.size === 0}>
            Tümünü kapat
          </button>
        </div>
      </div>

      {CATEGORIES.map((c) => {
        const fields = CHARTABLE.filter((f) => f.category === c.id);
        if (fields.length === 0) return null;
        return (
          <div className="cats-group" key={c.id}>
            <p className="cats-group-title">{c.title}</p>
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
      })}
    </div>
  );
}

// --- Grafik ---------------------------------------------------------------
// Saf SVG çoklu seri çizgi grafiği; harici kütüphane kullanmaz.
const W = 900;
const H = 330;
const PAD = { top: 16, right: 16, bottom: 34, left: 68 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

// Zaman ekseninde hedeflenen bölüm sayısı. Aralık körü körüne buna bölünmez;
// aşağıdaki "yuvarlak" adımlardan bu sayıyı aşmayan en küçüğü seçilir. Böylece
// etiketler 09/08 07 gibi rastgele değil, 09.08 06:00 gibi okunabilir
// sınırlara denk gelir.
const X_DIVISIONS = 10;

const DK = 60000;
const SA = 60 * DK;
const GUN = 24 * SA;
const TIME_STEPS = [
  DK, 2 * DK, 5 * DK, 10 * DK, 15 * DK, 30 * DK,
  SA, 2 * SA, 3 * SA, 6 * SA, 12 * SA,
  GUN,
];

function pickTimeStep(spanMs, target) {
  for (const step of TIME_STEPS) if (spanMs / step <= target) return step;
  // Bir günden geniş aralıklarda gün katlarına çıkılır.
  return Math.ceil(spanMs / target / GUN) * GUN;
}

// ms'yi yerel saate göre `step`in ilk katına yukarı yuvarlar.
function ceilToStep(ms, step) {
  const offset = new Date(ms).getTimezoneOffset() * DK;
  return Math.ceil((ms - offset) / step) * step + offset;
}

function buildTimeTicks(fromMs, toMs, target) {
  const step = pickTimeStep(toMs - fromMs, target);
  const ticks = [];
  for (let t = ceilToStep(fromMs, step); t <= toMs; t += step) ticks.push(t);
  return { ticks, step };
}

// Zamana en yakın noktayı ikili aramayla bulur (noktalar zamana göre sıralı).
function nearestPoint(points, t) {
  if (points.length === 0) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[lo - 1];
  if (b && Math.abs(b.t - t) < Math.abs(a.t - t)) return b;
  return a;
}

// İmlecin bir çizgi parçasına olan en kısa uzaklığı (SVG viewBox biriminde).
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const ratio = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
}

function Chart({ samples, series, fromMs, toMs, sampleMs }) {
  const clipId = useId();
  const svgRef = useRef(null);
  // İmlecin altındaki seri: { line, point, x, y, cssX, cssY }
  const [hover, setHover] = useState(null);

  // Her seri için { color, label, segments: [[{t,v}...]] }
  const lines = useMemo(() => {
    const gapMs = Math.max((sampleMs || 10000) * 3, 30000);
    return series.map((s) => {
      const pts = samples
        .map((row) => ({ t: Date.parse(row.t), v: Number(row[s.key]) }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));

      const segments = [];
      let cur = [];
      for (const p of pts) {
        if (cur.length && p.t - cur[cur.length - 1].t > gapMs) {
          segments.push(cur);
          cur = [];
        }
        cur.push(p);
      }
      if (cur.length) segments.push(cur);
      return { ...s, points: pts, segments };
    });
  }, [samples, series, sampleMs]);

  const allValues = lines.flatMap((l) => l.points.map((p) => p.v));
  const hasData = allValues.length > 0;

  let lo = hasData ? Math.min(...allValues) : 0;
  let hi = hasData ? Math.max(...allValues) : 2;
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  } else if (hasData) {
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
  }

  const x = (t) => PAD.left + ((t - fromMs) / (toMs - fromMs || 1)) * PLOT_W;
  const y = (v) => PAD.top + (1 - (v - lo) / (hi - lo)) * PLOT_H;

  const span = hi - lo;
  const axisDecimals = span >= 100 ? 0 : span >= 10 ? 1 : 2;
  const yTicks = Array.from({ length: 5 }, (_, i) => lo + (span * i) / 4);
  const spanMs = toMs - fromMs;
  const { ticks: xTicks, step: xStep } = buildTimeTicks(fromMs, toMs, X_DIVISIONS);

  // Tooltip yalnızca imleç gerçek bir seri çizgisine yeterince yakınsa açılır.
  const onMove = (e) => {
    const svg = svgRef.current;
    if (!svg || lines.length === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = W / rect.width; // viewBox birimi / CSS pikseli
    const vbX = (e.clientX - rect.left) * scale;
    const vbY = (e.clientY - rect.top) * scale;

    if (
      vbX < PAD.left || vbX > W - PAD.right ||
      vbY < PAD.top || vbY > PAD.top + PLOT_H
    ) {
      setHover(null);
      return;
    }

    let best = null;
    for (const l of lines) {
      for (const segment of l.segments) {
        if (segment.length === 1) {
          const p = segment[0];
          const d = Math.hypot(vbX - x(p.t), vbY - y(p.v));
          if (!best || d < best.d) best = { d, line: l };
          continue;
        }
        for (let i = 1; i < segment.length; i += 1) {
          const a = segment[i - 1];
          const b = segment[i];
          const d = distanceToSegment(
            vbX,
            vbY,
            x(a.t),
            y(a.v),
            x(b.t),
            y(b.v)
          );
          if (!best || d < best.d) best = { d, line: l };
        }
      }
    }
    // Yaklaşık 7 CSS pikseli dışındaki hareketleri çizgi üzerinde sayma.
    if (!best || best.d > 7 * scale) {
      setHover(null);
      return;
    }

    const t = fromMs + ((vbX - PAD.left) / PLOT_W) * (toMs - fromMs);
    const point = nearestPoint(best.line.points, t);
    const py = y(point.v);
    const px = x(point.t);
    setHover({
      line: best.line,
      point,
      x: px,
      y: py,
      // Kutucuk HTML olduğu için konum CSS pikseline çevrilir; kenarlardan
      // taşmasın diye sınırlanır.
      cssX: Math.min(Math.max(px / scale, 78), rect.width - 78),
      cssY: py / scale,
    });
  };

  return (
    <>
      <div className="chart-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="chart-svg"
          role="img"
          aria-label="Geçmiş grafiği"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={PLOT_W} height={PLOT_H} />
          </clipPath>
        </defs>

        <text
          className="chart-axis-title"
          transform={`rotate(-90 16 ${PAD.top + PLOT_H / 2}) translate(16 ${PAD.top + PLOT_H / 2})`}
          textAnchor="middle"
        >
          Değer
        </text>

        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} className="chart-grid" />
            <text x={PAD.left - 10} y={y(v) + 4} textAnchor="end" className="chart-axis">
              {formatNum(v, axisDecimals)}
            </text>
          </g>
        ))}

        {xTicks.map((t) => {
          // Etiketler artık yuvarlak sınırlara oturduğu için uçlara tam
          // denk gelmeyebilir; kenara yakın olanlar dışarı taşmasın.
          const px = x(t);
          const anchor =
            px < PAD.left + 24 ? 'start' : px > W - PAD.right - 24 ? 'end' : 'middle';
          return (
            <text key={t} x={px} y={H - 12} textAnchor={anchor} className="chart-axis">
              {formatAxisTime(t, spanMs, xStep)}
            </text>
          );
        })}

        {hover && (
          <line
            x1={hover.x}
            y1={PAD.top}
            x2={hover.x}
            y2={PAD.top + PLOT_H}
            className="chart-guide"
          />
        )}

        <g clipPath={`url(#${clipId})`}>
          {lines.map((l) =>
            l.segments.map((seg, i) =>
              seg.length > 1 ? (
                <path
                  key={`${l.key}-${i}`}
                  d={seg.map((p, j) => `${j === 0 ? 'M' : 'L'} ${x(p.t)} ${y(p.v)}`).join(' ')}
                  className={`chart-line ${hover?.line.key === l.key ? 'is-hover' : ''}`}
                  style={{ stroke: l.color }}
                />
              ) : (
                <circle
                  key={`${l.key}-${i}`}
                  cx={x(seg[0].t)}
                  cy={y(seg[0].v)}
                  r="2.5"
                  style={{ fill: l.color }}
                />
              )
            )
          )}
        </g>

        {hover && (
          <circle
            cx={hover.x}
            cy={hover.y}
            r="4.5"
            className="chart-marker"
            style={{ fill: hover.line.color }}
          />
        )}
      </svg>

        {hover && (
          <div className="chart-tip" style={{ left: `${hover.cssX}px`, top: `${hover.cssY}px` }}>
            <span className="chart-tip-head">
              <i style={{ background: hover.line.color }} aria-hidden="true" />
              {hover.line.label}
            </span>
            <span className="chart-tip-val">
              {formatNum(hover.point.v, hover.line.decimals)}
              {hover.line.unit ? <em> {hover.line.unit}</em> : null}
            </span>
            <span className="chart-tip-time">{formatStamp(hover.point.t)}</span>
          </div>
        )}
      </div>

      {series.length === 0 && (
        <p className="chart-hint">Grafiğe eklemek için aşağıdaki kategorilerden veri seçin.</p>
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

// Etiket ayrıntısı adıma göre kısalır: günlük adımda saat yazmaya gerek yok,
// tek günlük aralıkta da tarih tekrar etmesin.
function formatAxisTime(ms, spanMs, step) {
  const d = new Date(ms);
  const gun = d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
  const saat = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (step >= GUN) return gun;
  if (spanMs <= GUN) return saat;
  return `${gun} ${saat}`;
}
