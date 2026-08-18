import { useEffect, useState } from 'react';

// Tarih aralığı seçme paneli. "Geçmiş Grafik" ve "Sondaj Makine Raporu"
// sekmeleri aynı paneli kullanır; aralık kuralları (en fazla 7 gün, en çok 30
// gün geriye, gelecek yok) tek yerde durur.

export const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

// Geçmiş bellekte/veritabanında sınırlı olduğu için pratikte birkaç günden
// eskisi zaten yok; yine de kullanıcı 1970 ya da 2099 gibi anlamsız tarihler
// seçemesin diye seçilebilir pencere 30 günle sınırlanır. Üst sınır her zaman
// "şimdi"dir: gelecekte ölçüm olamaz.
export const MAX_PAST_DAYS = 30;

// Girdi ve mesajlar için tek doğrulama noktası; hem "Göster" düğmesinin
// etkinliği hem de istek öncesi son kontrol buradan geçer.
export function validateRange(fromStr, toStr, nowMs) {
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

// `datetime-local` girdisinin beklediği yerel biçim.
export function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Aralık durumunu (from/to) çağıran bileşen tutar; panel yalnızca çizer ve
// doğrular. `onSubmit` yalnızca seçim geçerliyken çağrılabilir.
export default function RangePicker({
  from,
  to,
  onFromChange,
  onToChange,
  onSubmit,
  loading = false,
  title = 'Görmek istediğiniz tarih aralığını seçin',
  note = 'En fazla 7 günlük aralık seçilebilir',
  submitLabel = 'Göster',
}) {
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

  return (
    <div className="history-panel">
      <p className="history-panel-title">{title}</p>
      <p className="history-panel-note">{note}</p>

      <div className="history-controls">
        <label className="history-field">
          <span className="history-field-label">Başlangıç</span>
          <input
            type="datetime-local"
            value={from}
            min={minInput}
            max={maxInput}
            aria-invalid={invalid}
            onChange={(e) => onFromChange(e.target.value)}
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
            onChange={(e) => onToChange(e.target.value)}
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
        onClick={onSubmit}
        disabled={loading || invalid}
        title={invalid ? check.error : 'Seçilen aralığı getir'}
      >
        {loading ? 'Yükleniyor…' : submitLabel}
      </button>
    </div>
  );
}
