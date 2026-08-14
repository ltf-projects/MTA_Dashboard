// "Dijital Makine Verileri" sekmesinde göstergelerin altındaki durum
// kutucukları (Hidrolik Sıcaklık, Filtre 1, Acil Stop ...).
//
// Alanlar dijital (0/1) girişlerdir: 0 = pasif, 0 dışındaki her değer aktif
// kabul edilir ve kutucuk uyarı rengine döner.

export default function DigitalCard({ label, value, stale = false }) {
  const numeric = typeof value === 'number' ? value : Number(value);
  const known = !stale && value !== null && value !== undefined && !Number.isNaN(numeric);
  const active = known && numeric !== 0;

  return (
    <div className={`digital-card ${active ? 'is-active' : ''} ${known ? '' : 'is-empty'}`}>
      <span className="digital-icon" aria-hidden="true">
        {active ? (
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5.5" />
            <circle cx="12" cy="16.4" r="0.9" fill="currentColor" stroke="none" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="m8.2 12.2 2.6 2.6 5-5.2" />
          </svg>
        )}
      </span>
      <div className="digital-body">
        <span className="digital-label">{label}</span>
        <span className="digital-value">
          {known ? numeric.toLocaleString('tr-TR') : stale ? 'Veri Yok' : '—'}
        </span>
      </div>
      <span className="digital-state">{known ? (active ? 'AKTİF' : 'NORMAL') : '—'}</span>
    </div>
  );
}
