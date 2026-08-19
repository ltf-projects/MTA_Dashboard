import { createClient } from '@supabase/supabase-js';

// Supabase bağlantı bilgileri derleme anında gömülür (Vite, yalnızca VITE_ ile
// başlayan değişkenleri arayüze aktarır). anon anahtarı tarayıcıya çıkması
// beklenen genel anahtardır; service_role anahtarı ASLA buraya konmaz.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Değişkenler eksikse istemci kurulmaz. Bu durumda giriş ekranı sessizce
// başarısız olmak yerine sebebini yazar.
export const supabaseReady = Boolean(url && anonKey);

if (!supabaseReady) {
  console.error(
    '[ARAYÜZ] VITE_SUPABASE_URL veya VITE_SUPABASE_ANON_KEY tanımlı değil; ' +
      'giriş yapılamaz. .env dosyasını doldurup Vite sunucusunu yeniden başlatın.'
  );
}

export const supabase = supabaseReady
  ? createClient(url, anonKey, {
      auth: {
        // Oturum tarayıcıda saklanır ve süresi dolmadan otomatik yenilenir;
        // sayfa yenilendiğinde kullanıcı tekrar giriş yapmak zorunda kalmaz.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
