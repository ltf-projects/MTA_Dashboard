import { useCallback, useEffect, useMemo, useState } from 'react';

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

// Kayıtlı ayar eksik ya da bozuksa alanın fields.js'teki tanımı geçerlidir.
function num(candidate, fallback) {
  // Number(null) 0 döndürdüğü için boş değerler ayrıca elenir.
  if (candidate === null || candidate === undefined || candidate === '') return fallback;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNum(v, decimals) {
  return v.toLocaleString('tr-TR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default function Gauge({
  fieldKey,
  thresholds: storedThresholds,
  onThresholdSave,
  label,
  value,
  unit,
  min: fieldMin,
  max: fieldMax,
  zones,
  decimals = 2,
  tickDecimals = 0,
  stale = false,
}) {
  const defaultWarning = zones.find((zone) => zone.level === 'normal')?.to ?? fieldMin;
  const defaultCritical = zones.find((zone) => zone.level === 'warning')?.to ?? fieldMax;

  // Gösterge ayarları (aralık + eşikler) veritabanından gelir; gelmeyen ya da
  // sayıya çevrilemeyen her alan fields.js'teki tanıma düşer.
  const withDefaults = useCallback(
    (stored) => ({
      warning: num(stored?.warning, defaultWarning),
      critical: num(stored?.critical, defaultCritical),
      min: num(stored?.min, fieldMin),
      max: num(stored?.max, fieldMax),
    }),
    [defaultWarning, defaultCritical, fieldMin, fieldMax]
  );

  const [settings, setSettings] = useState(() => withDefaults(storedThresholds));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(settings);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Aralık da düzenlenebildiği için çizim boyunca kayıtlı sınırlar kullanılır.
  const { min, max } = settings;

  useEffect(() => {
    if (!storedThresholds) return;
    const next = withDefaults(storedThresholds);
    setSettings(next);
    if (!editing) setDraft(next);
  }, [storedThresholds, editing, withDefaults]);

  useEffect(() => {
    if (!editing) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setEditing(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [editing]);

  const activeZones = useMemo(
    () => [
      { to: settings.warning, level: 'normal' },
      { to: settings.critical, level: 'warning' },
      { to: max, level: 'danger' },
    ],
    [settings, max]
  );

  const openEditor = () => {
    setDraft(settings);
    setFormError('');
    setEditing(true);
  };

  const saveThresholds = async (event) => {
    event.preventDefault();
    const nextMin = Number(draft.min);
    const nextMax = Number(draft.max);
    const warning = Number(draft.warning);
    const critical = Number(draft.critical);
    if (
      !Number.isFinite(nextMin) || !Number.isFinite(nextMax) ||
      !Number.isFinite(warning) || !Number.isFinite(critical)
    ) {
      setFormError('Tüm değerler sayı olmalıdır.');
      return;
    }
    if (nextMin >= nextMax) {
      setFormError('Minimum değer maksimum değerden küçük olmalıdır.');
      return;
    }
    if (warning <= nextMin || warning >= critical || critical > nextMax) {
      setFormError(`Değerler ${nextMin} < uyarı < kritik ≤ ${nextMax} sırasına uymalıdır.`);
      return;
    }
    const next = { warning, critical, min: nextMin, max: nextMax };
    try {
      setSaving(true);
      await onThresholdSave?.(fieldKey, next);
      setSettings(next);
      setEditing(false);
    } catch (error) {
      setFormError(error.message || 'Eşikler kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

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
    const last = activeZones.length - 1;
    return activeZones
      .map((z, i) => {
        const a1 = valueToAngle(from, min, max);
        const a2 = valueToAngle(z.to, min, max) - (i === last ? 0 : OVERLAP);
        from = z.to;
        return a1 > a2 ? { key: i, level: z.level, path: arcPath(a1, a2) } : null;
      })
      .filter(Boolean);
  }, [activeZones, min, max]);

  // Yayın dış uçları: düz kesim yerine yuvarlak görünsün diye uçlara birer
  // daire konur (ilk/son bölgenin renginde).
  const capStart = polar(180);
  const capEnd = polar(0);
  const firstLevel = activeZones[0]?.level ?? 'normal';
  const lastLevel = activeZones[activeZones.length - 1]?.level ?? 'normal';

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
      {/* Büyük harfe CSS ile değil burada çevrilir: text-transform Türkçe
          kuralını (i → İ) her tarayıcıda uygulamıyor, "SERVIS" gibi yanlış
          sonuç verebiliyordu. */}
      <span className="gauge-label" title={label}>
        {label.toLocaleUpperCase('tr-TR')}
      </span>
      <button
        type="button"
        className="gauge-edit"
        aria-label={`${label} gösterge aralığını ve eşik değerlerini düzenle`}
        title="Gösterge aralığını ve eşik değerlerini düzenle"
        onClick={openEditor}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m4 16-.7 4.7L8 20l10.6-10.6-4-4L4 16Z" />
          <path d="m13.7 6.3 4 4" />
        </svg>
      </button>

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

      {editing && (
        <div className="gauge-modal-backdrop" onMouseDown={() => setEditing(false)}>
          <form
            className="gauge-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`gauge-modal-${fieldKey || label}`}
            onSubmit={saveThresholds}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="gauge-modal-head">
              <div>
                <h3 id={`gauge-modal-${fieldKey || label}`}>{label}</h3>
                <p>Gösterge aralığını ve renk geçişlerini güncelleyin.</p>
              </div>
              <button type="button" className="gauge-modal-close" onClick={() => setEditing(false)} aria-label="Kapat">×</button>
            </div>
            <div className="gauge-threshold-row">
              <label className="gauge-threshold-field">
                <span>Minimum {unit && `(${unit})`}</span>
                <input
                  type="number"
                  step="any"
                  value={draft.min}
                  autoFocus
                  onChange={(event) => setDraft((old) => ({ ...old, min: event.target.value }))}
                />
              </label>
              <label className="gauge-threshold-field">
                <span>Maksimum {unit && `(${unit})`}</span>
                <input
                  type="number"
                  step="any"
                  value={draft.max}
                  onChange={(event) => setDraft((old) => ({ ...old, max: event.target.value }))}
                />
              </label>
            </div>
            <div className="gauge-threshold-row">
              <label className="gauge-threshold-field">
                <span>Uyarı değeri {unit && `(${unit})`}</span>
                <input
                  type="number"
                  min={draft.min}
                  max={draft.max}
                  step="any"
                  value={draft.warning}
                  onChange={(event) => setDraft((old) => ({ ...old, warning: event.target.value }))}
                />
              </label>
              <label className="gauge-threshold-field">
                <span>Kritik değer {unit && `(${unit})`}</span>
                <input
                  type="number"
                  min={draft.min}
                  max={draft.max}
                  step="any"
                  value={draft.critical}
                  onChange={(event) => setDraft((old) => ({ ...old, critical: event.target.value }))}
                />
              </label>
            </div>
            <p className="gauge-threshold-range">
              Fabrika aralığı: {formatNum(fieldMin, tickDecimals)} – {formatNum(fieldMax, tickDecimals)} {unit}
            </p>
            {formError && <p className="gauge-threshold-error" role="alert">{formError}</p>}
            <div className="gauge-modal-actions">
              <button type="button" className="gauge-cancel-btn" onClick={() => setEditing(false)} disabled={saving}>İptal</button>
              <button type="submit" className="gauge-save-btn" disabled={saving}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
