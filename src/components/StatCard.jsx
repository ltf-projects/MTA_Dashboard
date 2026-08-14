// "Motor Verileri" sekmesinde radyal göstergelerin üstünde duran geniş özet
// kartları (Voltaj / Üretici Kodu / Sondaj Makinesi Çalışma Saati).

const ICONS = {
  bolt: (
    <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" />
  ),
  chip: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <rect x="9" y="9" width="6" height="6" rx="1.2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
};

function formatNum(v, decimals) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '—';
  return v.toLocaleString('tr-TR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default function StatCard({
  label,
  value,
  unit,
  decimals = 0,
  icon = 'chip',
  tone = 'amber',
  stale = false,
}) {
  const hasValue = !stale && typeof value === 'number' && !Number.isNaN(value);

  return (
    <div className={`stat-card stat-card--${tone} ${hasValue ? '' : 'is-empty'}`}>
      <span className="stat-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">{ICONS[icon] || ICONS.chip}</svg>
      </span>
      <div className="stat-body">
        <span className="stat-label">{label}</span>
        <span className="stat-value">
          {hasValue ? formatNum(value, decimals) : stale ? 'Veri Yok' : '—'}
          {unit && hasValue ? <span className="stat-unit"> {unit}</span> : null}
        </span>
      </div>
    </div>
  );
}
