import { useEffect, useRef, useState } from 'react';
import { DEFAULT_MODE, MODES, STORAGE_KEY } from '../config/themes.js';

// Üst bardaki görünüm düğmesi. Tıklanınca altında Sistem / Koyu / Açık
// seçenekleri açılır; düğme o an seçili modun ikonunu taşır.
//
// Seçim <html data-theme="..."> özniteliğine yazılır ve tüm renkler CSS
// değişkenlerinden geldiği için arayüz anında değişir. Tercih localStorage'da
// saklanır (index.html'deki küçük script sayfa boyanmadan önce uygular,
// böylece açılışta tema titremesi olmaz).

// Sistem modunda hangi paletin seçileceğini belirler. matchMedia yoksa ya da
// sistem koyudaysa varsayılan koyu palettir.
const LIGHT_QUERY = '(prefers-color-scheme: light)';

function systemPalette() {
  return window.matchMedia?.(LIGHT_QUERY).matches ? 'light' : 'dark';
}

function readStoredMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && MODES.some((m) => m.id === saved)) return saved;
  } catch {
    /* localStorage kapalıysa varsayılana düş */
  }
  return DEFAULT_MODE;
}

export default function ThemePicker() {
  const [mode, setMode] = useState(readStoredMode);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const apply = () =>
      document.documentElement.setAttribute(
        'data-theme',
        mode === 'system' ? systemPalette() : mode
      );

    apply();
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* yazamazsak sorun değil, oturum boyunca geçerli kalır */
    }

    // Sistem modundayken kullanıcı işletim sistemi ayarını değiştirirse
    // arayüz sayfa yenilemeden birlikte değişsin.
    if (mode !== 'system') return;
    const mq = window.matchMedia?.(LIGHT_QUERY);
    if (!mq) return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [mode]);

  // Dışarı tıklama ve Esc ile kapan
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const active = MODES.find((m) => m.id === mode) || MODES[0];

  return (
    <div className="theme-picker" ref={rootRef}>
      <button
        type="button"
        className={`theme-btn ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Görünüm: ${active.name}`}
        aria-label={`Görünüm: ${active.name}. Değiştirmek için aç.`}
      >
        <ModeIcon id={active.id} />
      </button>

      {open && (
        <div className="theme-menu" role="listbox" aria-label="Görünüm modu">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={m.id === mode}
              className={`theme-option ${m.id === mode ? 'active' : ''}`}
              onClick={() => {
                setMode(m.id);
                setOpen(false);
              }}
            >
              <ModeIcon id={m.id} />
              <span className="theme-option-body">
                <span className="theme-option-name">{m.name}</span>
                <span className="theme-option-note">{m.note}</span>
              </span>
              {m.id === mode && <span className="theme-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Sade, çizgi tabanlı ikonlar — arayüzün geri kalanıyla aynı dil.
function ModeIcon({ id }) {
  return (
    <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      {id === 'system' ? (
        <>
          <rect x="2.8" y="4.2" width="18.4" height="12.6" rx="2.2" />
          <path d="M9 20.2h6M12 16.8v3.4" />
        </>
      ) : id === 'light' ? (
        <>
          <circle cx="12" cy="12" r="4.1" />
          <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6" />
        </>
      ) : (
        <path d="M20.5 14.3A8.6 8.6 0 0 1 9.7 3.5a8.6 8.6 0 1 0 10.8 10.8z" />
      )}
    </svg>
  );
}
