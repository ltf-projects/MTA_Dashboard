import { useState } from 'react';
import { supabase, supabaseReady } from '../lib/supabase.js';
import ThemePicker from './ThemePicker.jsx';

// Supabase'in İngilizce hata metinleri son kullanıcıya gösterilmez; bilinen
// durumlar Türkçeye çevrilir, tanınmayan hata olduğu gibi geçer.
function turkceHata(mesaj) {
  const m = (mesaj || '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-posta veya şifre hatalı.';
  if (m.includes('email not confirmed')) return 'E-posta adresi henüz doğrulanmamış.';
  if (m.includes('too many requests') || m.includes('rate limit'))
    return 'Çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin.';
  if (m.includes('failed to fetch') || m.includes('network'))
    return 'Sunucuya ulaşılamıyor. İnternet bağlantınızı kontrol edin.';
  return mesaj || 'Giriş yapılamadı.';
}

// Uygulamanın giriş ekranı. Kimlik doğrulama Supabase Auth ile yapılır;
// başarılı girişte oturum olayını App dinler ve panele geçer — bu bileşenin
// ayrıca haber vermesi gerekmez.
//
// Yerleşim: fotoğraf tüm ekranı kaplar, form kartı ortada durur.
export default function LoginView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    supabaseReady
      ? ''
      : 'Supabase ayarları eksik: VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY tanımlanmalı.'
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy || !supabaseReady) return;

    const eposta = email.trim();
    if (!eposta || !password) {
      setError('E-posta ve şifre alanlarını doldurun.');
      return;
    }

    setBusy(true);
    setError('');

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: eposta,
      password,
    });

    // Başarılıysa bileşen zaten sökülüyor; yalnızca hata durumunu ele al.
    if (authError) {
      setError(turkceHata(authError.message));
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-theme">
        <ThemePicker />
      </div>

      {/* --- Arka plan görseli (yalnızca dekoratif) --- */}
      <div className="login-visual" aria-hidden="true" />

      {/* --- Sağ: giriş formu --- */}
      <section className="login-panel">
        <form className="login-card" onSubmit={handleSubmit}>
          <h2 className="login-title">Giriş Yap</h2>
          <p className="login-sub">Lütfen hesabınıza giriş yapın.</p>

          <label className="login-label" htmlFor="login-user">
            E-posta
          </label>
          <div className="login-field">
            <MailIcon />
            <input
              id="login-user"
              type="email"
              autoComplete="username"
              placeholder="ornek@mta.gov.tr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </div>

          <label className="login-label" htmlFor="login-pass">
            Şifre
          </label>
          <div className="login-field">
            <LockIcon />
            <input
              id="login-pass"
              type={showPass ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              className="login-eye"
              onClick={() => setShowPass((v) => !v)}
              aria-label={showPass ? 'Şifreyi gizle' : 'Şifreyi göster'}
              title={showPass ? 'Şifreyi gizle' : 'Şifreyi göster'}
              tabIndex={-1}
            >
              {showPass ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>

          {/* Hata alanı: ekran okuyucular da anında duysun. */}
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="login-submit" disabled={busy || !supabaseReady}>
            {busy ? <Spinner /> : <LoginIcon />}
            {busy ? 'Giriş yapılıyor…' : 'Giriş Yap'}
          </button>
        </form>
      </section>
    </div>
  );
}

/* ---------- Simgeler (tek renk, metin rengini miras alır) ---------- */

const ICON = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

function MailIcon() {
  return (
    <svg {...ICON} className="login-icon">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="m3.5 6.5 8.5 6 8.5-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg {...ICON} className="login-icon">
      <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg {...ICON}>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg {...ICON}>
      <path d="M4 4.5 20 20" />
      <path d="M9.6 6.1A9.9 9.9 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a18 18 0 0 1-3.3 4.1" />
      <path d="M6.5 8A18 18 0 0 0 2 12s3.6 6.5 10 6.5c1.2 0 2.3-.2 3.3-.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function Spinner() {
  return <span className="login-spinner" aria-hidden="true" />;
}

function LoginIcon() {
  return (
    <svg {...ICON} width="19" height="19">
      <path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10" />
      <path d="M14.5 8.5 18.5 12l-4 3.5" />
      <path d="M18 12H9.5" />
    </svg>
  );
}
