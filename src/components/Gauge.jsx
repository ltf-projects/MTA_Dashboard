import { useMemo } from 'react';

// Yarım daire ibre göstergesi. Saf SVG — harici kütüphane gerekmez.
//
// Bölgeler (Normal / Uyarı / Tehlike) kesintisiz tek bir yay oluşturur:
// renkler birbirine değer, sınırlar düz kesimle keskindir — araya boşluk
// konmaz, çünkü dar bölgeler (ör. 190–215) boşlukla ayrılınca yaydan kopmuş
// ayrı lekeler gibi görünüyordu. Yayın yalnızca iki dış ucu yuvarlatılır.
// İbre nötr renktedir, böylece renk yalnızca bölgeyi anlatır.
const W = 200;
const H = 132;
const CX = 100;
const CY = 96;
const R = 74;
const STROKE = 10;
const NEEDLE_LEN = R - 14;
const TICK_Y = 112;
const TICK_INSET = 8;

// Komşu segmentler arasında antialias dikişi kalmasın diye her segment bir
// sonrakinin altına azıcık taşar; üstte çizilen segment taşan kısmı örter.
const OVERLAP = 0.5;

function polar(angleDeg, radius = R) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) };
}

// value -> 180°(min, sol) .. 0°(maks, sağ), tepeden geçen yay.
function valueToAngle(value, min, max) {
  const f = max === min ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  return 180 - f * 180;
}

function arcPath(angleStart, angleEnd, radius = R) {
  const p1 = polar(angleStart, radius);
  const p2 = polar(angleEnd, radius);
  return `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 0 1 ${p2.x} ${p2.y}`;
}

function formatNum(v, decimals) {
  return v.toLocaleString('tr-TR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default function Gauge({
  label,
  value,
  unit,
  min,
  max,
  zones,
  decimals = 2,
  tickDecimals = 0,
  stale = false,
}) {
  // Değer yoksa (alan pakette gelmiyorsa ya da araçtan veri akmıyorsa) ibre
  // min'de durur; metin "—" veya "Veri Yok" olur.
  const hasValue = !stale && typeof value === 'number' && !Number.isNaN(value);
  const clamped = hasValue ? Math.min(max, Math.max(min, value)) : min;
  const needleAngle = valueToAngle(clamped, min, max);

  // Değer gösterge aralığının dışındaysa ibre uca kilitlenir ve orada kalır —
  // bu, "gösterge bozuk/donmuş" gibi görünür. Böyle bir durumu sessiz
  // geçmemek için değeri işaretleriz: aralık ya da veri hatalıdır.
  const outOfRange = hasValue && (value > max || value < min);

  const zoneArcs = useMemo(() => {
    let from = min;
    const last = zones.length - 1;
    return zones
      .map((z, i) => {
        const a1 = valueToAngle(from, min, max);
        const a2 = valueToAngle(z.to, min, max) - (i === last ? 0 : OVERLAP);
        from = z.to;
        return a1 > a2 ? { key: i, level: z.level, path: arcPath(a1, a2) } : null;
      })
      .filter(Boolean);
  }, [zones, min, max]);

  // Yayın dış uçları: düz kesim yerine yuvarlak görünsün diye uçlara birer
  // daire konur (ilk/son bölgenin renginde).
  const capStart = polar(180);
  const capEnd = polar(0);
  const firstLevel = zones[0]?.level ?? 'normal';
  const lastLevel = zones[zones.length - 1]?.level ?? 'normal';

  const valueText = hasValue ? formatNum(value, decimals) : stale ? 'Veri Yok' : '—';

  return (
    <div
      className={`gauge-card ${hasValue ? '' : 'gauge-card--empty'} ${outOfRange ? 'gauge-card--over' : ''}`}
      title={
        outOfRange
          ? `${label}: ${valueText} değeri gösterge aralığının (${formatNum(min, tickDecimals)} – ${formatNum(max, tickDecimals)}) dışında. İbre uçta sabit kalır.`
          : undefined
      }
    >
      <span className="gauge-label" title={label}>
        {label}
      </span>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="gauge-svg"
        role="img"
        aria-label={`${label}: ${valueText}${unit && hasValue ? ` ${unit}` : ''}`}
      >
        <path d={arcPath(180, 0)} className="gauge-track" />

        {zoneArcs.map((seg) => (
          <path key={seg.key} d={seg.path} className={`gauge-zone zone-${seg.level}`} />
        ))}

        <circle
          cx={capStart.x}
          cy={capStart.y}
          r={STROKE / 2}
          className={`gauge-cap zone-${firstLevel}`}
        />
        <circle
          cx={capEnd.x}
          cy={capEnd.y}
          r={STROKE / 2}
          className={`gauge-cap zone-${lastLevel}`}
        />

        {/* Referans arayüzdeki gibi yalnızca alt ve üst sınır etiketlenir. */}
        <text x={TICK_INSET} y={TICK_Y} textAnchor="start" className="gauge-tick">
          {formatNum(min, tickDecimals)}
        </text>
        <text x={W - TICK_INSET} y={TICK_Y} textAnchor="end" className="gauge-tick">
          {formatNum(max, tickDecimals)}
        </text>

        {/* İbre sola (min) bakacak şekilde çizilir, açıya CSS ile döndürülür —
            böylece değer değişimi yumuşak bir geçişle animasyonlanır. */}
        <g className="gauge-needle" style={{ transform: `rotate(${180 - needleAngle}deg)` }}>
          <polygon points={`${CX - NEEDLE_LEN},${CY} ${CX},${CY - 3.4} ${CX},${CY + 3.4}`} />
        </g>
        <circle cx={CX} cy={CY} r="4.5" className="gauge-pivot" />

        {/* Aralık dışındayken ibrenin kilitlendiği uca küçük bir ok konur. */}
        {outOfRange && (
          <path
            className="gauge-over-mark"
            d={
              value > max
                ? `M ${W - TICK_INSET - 4} ${TICK_Y - 16} l 5 5 l -5 5 z`
                : `M ${TICK_INSET + 4} ${TICK_Y - 16} l -5 5 l 5 5 z`
            }
          />
        )}

        <text
          x={CX}
          y={H - 5}
          textAnchor="middle"
          className={`gauge-value-text ${hasValue ? '' : 'is-empty'} ${outOfRange ? 'is-over' : ''}`}
        >
          {valueText}
          {unit && hasValue ? <tspan className="gauge-value-unit"> {unit}</tspan> : null}
        </text>
      </svg>
    </div>
  );
}
