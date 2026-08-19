import { useEffect, useState } from 'react';
import { supabase, supabaseReady } from './lib/supabase.js';
import LoginView from './components/LoginView.jsx';
import Dashboard from './components/Dashboard.jsx';

// Uygulamanın oturum kapısı. Panel bileşeni yalnızca geçerli bir Supabase
// oturumu varken takılır; oturum yoksa React ağacında panele ait hiçbir şey
// bulunmaz, dolayısıyla köprüye bağlantı da açılmaz.
export default function App() {
  // undefined: kayıtlı oturum henüz okunuyor. null: oturum yok.
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    if (!supabaseReady) {
      setSession(null);
      return;
    }

    // Sayfa yenilendiğinde tarayıcıda saklı oturum geri yüklenir.
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));

    // Giriş, çıkış ve jeton yenileme olaylarını tek yerden dinle.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) =>
      setSession(next ?? null)
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // Oturum okunurken panel de giriş ekranı da gösterilmez; aksi halde kayıtlı
  // oturumu olan kullanıcı her yenilemede giriş ekranını bir an görür.
  if (session === undefined) {
    return (
      <div className="boot-screen" role="status" aria-live="polite">
        <span className="boot-spinner" aria-hidden="true" />
        <span>Oturum denetleniyor…</span>
      </div>
    );
  }

  if (!session) return <LoginView />;

  return <Dashboard session={session} />;
}
