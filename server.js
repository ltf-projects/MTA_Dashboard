// ---------------------------------------------------------------------------
// MTA Dashboard - MQTT Köprü Sunucusu
//
// Tarayıcılar 8883 (TLS üzerinden native MQTT) portuna doğrudan bağlanamaz.
// Bu Node.js köprüsü broker'a bağlanır, "Hoytek-IOT" topic'ini dinler, gelen
// JSON paketlerinden yalnızca hedef box_id'ye ait olanları süzer ve Socket.IO
// üzerinden React arayüze aktarır.
// ---------------------------------------------------------------------------
import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import mqtt from 'mqtt';
import pg from 'pg';
import { Server } from 'socket.io';
// Tablo sütunları arayüzdeki alan tanımlarından türetilir; tek kaynak orası
// kalsın diye köprü de aynı dosyayı okur (saf veri, React bağımlılığı yok).
import { FIELDS } from './src/config/fields.js';

const {
  MQTT_HOST = 'temelsondajtakip.com',
  MQTT_PORT = '8883',
  MQTT_USERNAME = 'root',
  MQTT_PASSWORD = '',
  MQTT_TLS = 'true',
  MQTT_REJECT_UNAUTHORIZED = 'false',
  // Tüm cihazlar aynı topic'e yayın yapıyor; ayrım box_id alanıyla yapılır.
  // Broker'daki gerçek topic adı sonunda eğik çizgi taşıyor ("Hoytek-IOT/") —
  // MQTT Explorer bunu "Hoytek-IOT" gibi gösterir. "#" joker'i hem eğik
  // çizgili hem çizgisiz yayını yakaladığı için varsayılan bu şekildedir.
  MQTT_TOPIC = 'Hoytek-IOT/#',
  BOX_ID = '20',
  // Analog göstergeler istek/cevap topic'leri üzerinden canlı okunur.
  MQTT_ANALOG_REQUEST_TOPIC = '',
  MQTT_ANALOG_RESPONSE_TOPIC = '',
  ANALOG_REQUEST_INTERVAL_MS = '1000',
  BRIDGE_PORT = '4001',
  // Çoğu barındırma sağlayıcısı (Railway/Render/Fly.io) dinlenecek portu
  // otomatik olarak PORT ortam değişkeniyle verir; o varsa öncelikli kullanılır.
  PORT,
  // Prod ortamında arayüzün gerçek adresine kilitlemek için
  // (örn. "https://mta-dashboard.vercel.app"). Virgülle birden fazla verilebilir.
  ALLOWED_ORIGIN = '*',
  // "Geçmiş Grafik" sekmesi: örnekler PostgreSQL'e yazılır.
  // Paketler saniyede birkaç kez gelebiliyor; grafik için bu çözünürlük
  // gereksiz, o yüzden en fazla HISTORY_SAMPLE_MS'de bir satır yazılır.
  HISTORY_SAMPLE_MS = '5000',
  // postgres://kullanici:sifre@sunucu:5432/veritabani
  // Tanımlı değilse geçmiş kaydı kapalıdır; canlı izleme normal çalışır.
  DATABASE_URL = '',
  // Barındırılan Postgres'lerin çoğu TLS ister (Neon, Supabase, Railway...).
  DATABASE_SSL = 'false',
  // --- Kimlik doğrulama (Supabase Auth) ---
  // Arayüzün kullandığı projeyle AYNI olmalı; jetonlar bu projeye sorulur.
  // İkisi de anon (genel) anahtardır, service_role anahtarı gerekmez.
  SUPABASE_URL = '',
  SUPABASE_ANON_KEY = '',
} = process.env;

const listenPort = Number(PORT || BRIDGE_PORT);
const boxId = Number(BOX_ID);
const analogRequestTopic = MQTT_ANALOG_REQUEST_TOPIC || `reqAnalogData/${boxId}`;
const analogResponseTopic = MQTT_ANALOG_RESPONSE_TOPIC || `resAnalogData/${boxId}`;
const analogRequestIntervalMs = Math.max(Number(ANALOG_REQUEST_INTERVAL_MS) || 1000, 250);
const allowedOrigins =
  ALLOWED_ORIGIN === '*' ? '*' : ALLOWED_ORIGIN.split(',').map((o) => o.trim());

const useTls = String(MQTT_TLS).toLowerCase() === 'true';
const protocol = useTls ? 'mqtts' : 'mqtt';
const brokerUrl = `${protocol}://${MQTT_HOST}:${MQTT_PORT}`;

// --- Express + Socket.IO ---
const app = express();
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '32kb' }));
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: allowedOrigins } });

// ---------------------------------------------------------------------------
// KİMLİK DOĞRULAMA
//
// Köprü canlı makine verisi taşıyor; giriş yapmamış kimse buna erişememeli.
// Hem Socket.IO el sıkışması hem de veri uçları (/history, /report) Supabase
// erişim jetonu ister.
//
// Jeton, Supabase'in kendi /auth/v1/user ucuna sorularak doğrulanır. Böylece
// JWT imza sırrını burada tutmak gerekmez; yalnızca genel anon anahtar yeter.
// ---------------------------------------------------------------------------
const authConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!authConfigured) {
  console.error(
    '[KÖPRÜ] SUPABASE_URL / SUPABASE_ANON_KEY tanımlı değil. Kimlik doğrulanamadığı ' +
      'için TÜM bağlantılar reddedilecek. .env dosyasını doldurup köprüyü yeniden başlatın.'
  );
}

// Aynı jeton saniyede birkaç kez gelebilir (socket + iki fetch). Her seferinde
// Supabase'e gitmemek için kısa ömürlü bir önbellek tutulur.
const TOKEN_CACHE_MS = 60_000;
const tokenCache = new Map();

async function verifyToken(token) {
  if (!authConfigured || !token) return null;

  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      // Geçersiz jetonu da kısa süre hatırla: kopmuş bir istemci saniyede
      // onlarca kez denerse Supabase'i yormasın.
      tokenCache.set(token, { user: null, expiresAt: Date.now() + 10_000 });
      return null;
    }
    const user = await res.json();
    tokenCache.set(token, { user, expiresAt: Date.now() + TOKEN_CACHE_MS });
    return user;
  } catch (err) {
    console.error('[KÖPRÜ] Jeton doğrulanamadı:', err.message);
    return null;
  }
}

// Önbellek sınırsız büyümesin: süresi geçmiş kayıtlar arada temizlenir.
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of tokenCache) {
    if (entry.expiresAt <= now) tokenCache.delete(token);
  }
}, TOKEN_CACHE_MS).unref?.();

// Socket.IO el sıkışması: istemci jetonu `auth.token` içinde gönderir.
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  const user = await verifyToken(token);
  if (!user) {
    next(new Error('Yetkisiz: geçerli bir oturum gerekiyor.'));
    return;
  }
  socket.data.user = user;
  next();
});

// Veri uçları için: Authorization: Bearer <jeton>
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = await verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'Yetkisiz: geçerli bir oturum gerekiyor.' });
    return;
  }
  req.user = user;
  next();
}

// Son bilinen değeri sakla; yeni bağlanan arayüze hemen gönderelim.
const lastState = {
  connection: {
    connected: false,
    broker: brokerUrl,
    topic: MQTT_TOPIC,
    analogTopic: analogResponseTopic,
    error: null,
    boxId,
    // Hedef box_id'den en az bir paket görüldü mü?
    dataSeen: false,
  },
  data: null,
  analogData: null,
};

// --- Geçmiş örnekleri (PostgreSQL) -----------------------------------------
// Her HISTORY_SAMPLE_MS'de bir satır `sondaj_ornekleri` tablosuna yazılır.
// Yazma tamamen köprüye aittir: tarayıcı açık olmasa da, bu süreç ayakta
// olduğu sürece kayıt sürer.
//
// DATABASE_URL tanımlı değilse geçmiş kaydı sessizce kapanır — canlı izleme
// (MQTT -> Socket.IO) veritabanından bağımsız çalışmaya devam eder.
const historySampleMs = Math.max(Number(HISTORY_SAMPLE_MS) || 5000, 250);

const TABLE = 'sondaj_ornekleri';
const THRESHOLD_TABLE = 'gosterge_esikleri';
const FIELD_KEYS = [...new Set(FIELDS.filter((f) => f.key).map((f) => f.key))];
const GAUGE_FIELDS = FIELDS.filter((f) => f.kind === 'gauge' && f.key);
const GAUGE_BY_KEY = new Map(GAUGE_FIELDS.map((f) => [f.key, f]));
const thresholdCache = new Map();
// Motorun ömür boyu çalışma saati: kümülatif sayaç, /report bunun farkını alır.
const ENGINE_HOURS_KEY = 'CAN_Engine_Total_Hours_Of_Operation';
// Motor devri: sıfır olan örnekler motorun durduğu anları işaretler.
const ENGINE_SPEED_KEY = 'CAN_Engine_Speed';
// Rotasyon devrinin gerçek çalışma bandına çıktığı her ayrı blok bir manevra
// sayılır. Düşük devirdeki sensör gürültüsü/boşta dönüş sayılmasın; blok
// içindeki kısa veri düşüşleri ve kararsız başlangıç sıçramaları da ikinci bir
// manevra üretmesin. Beş dakikadan uzun süre çalışma bandına dönülmezse yeni
// bir rotasyon bloğu başlamış kabul edilir.
const ROTATION_SPEED_KEY = 'AuxData1';
const ROTATION_ACTIVE_RPM = 500;
const ROTATION_RESTART_GAP_SEC = 5 * 60;
// Manevranın hemen dışındaki sıfırdan büyük, çalışma eşiğinin altındaki
// rotasyon değerleri (sahada çoğunlukla yaklaşık 20) hazırlık/toparlama
// hareketidir. Örnekler arasındaki bir dakikadan büyük kayıt boşlukları süreye
// eklenmez.
const ROTATION_OPERATION_MIN_RPM = 0;
// Wireline basıncı normal seyirde yaklaşık 0-120 BAR aralığında kalıyor.
// 150 BAR ve üstüne çıkan, aralarında beş dakikadan fazla boşluk bulunan her
// ayrı blok grafikteki bir Wireline tepesidir.
const WIRELINE_PRESSURE_KEY = 'AnalogData7';
const WIRELINE_PEAK_BAR = 150;
const WIRELINE_PEAK_RESTART_GAP_SEC = 5 * 60;
// Alan adları büyük/küçük harf karışık (AnalogData1); Postgres tırnaksız
// tanımlayıcıları küçük harfe indirdiği için her yerde tırnaklanır.
const q = (name) => `"${name.replace(/"/g, '""')}"`;

const historyEnabled = Boolean(DATABASE_URL);
let dbReady = false;
let dbError = null;
let lastSampleAt = 0;
let lastWriteAt = null;

const pool = historyEnabled
  ? new pg.Pool({
      connectionString: DATABASE_URL,
      ssl:
        String(DATABASE_SSL).toLowerCase() === 'true'
          ? { rejectUnauthorized: false }
          : undefined,
      max: 4,
      idleTimeoutMillis: 30000,
    })
  : null;

// Havuzdaki boştaki bağlantı düşerse süreç çökmesin.
pool?.on('error', (e) => {
  dbError = e.message;
  console.error('[KÖPRÜ] Veritabanı havuz hatası:', e.message);
});

// Tabloyu ve eksik sütunları oluşturur. fields.js'e yeni bir alan eklendiğinde
// köprüyü yeniden başlatmak sütunu da ekler; elle migration gerekmez.
async function initDb() {
  if (!pool) {
    console.log('[KÖPRÜ] DATABASE_URL tanımlı değil — geçmiş kaydı kapalı.');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        zaman TIMESTAMPTZ NOT NULL,
        box_id INTEGER NOT NULL,
        PRIMARY KEY (box_id, zaman)
      )
    `);
    for (const key of FIELD_KEYS) {
      await pool.query(
        `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS ${q(key)} DOUBLE PRECISION`
      );
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${THRESHOLD_TABLE} (
        id BIGSERIAL PRIMARY KEY,
        box_id INTEGER NOT NULL,
        alan_anahtari TEXT NOT NULL,
        uyari_degeri DOUBLE PRECISION NOT NULL,
        kritik_degeri DOUBLE PRECISION NOT NULL,
        gecerli_baslangic TIMESTAMPTZ NOT NULL DEFAULT now(),
        gecerli_bitis TIMESTAMPTZ,
        guncelleyen_kullanici TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS gosterge_esikleri_aktif_idx
        ON ${THRESHOLD_TABLE} (box_id, alan_anahtari)
        WHERE gecerli_bitis IS NULL;
      ALTER TABLE ${THRESHOLD_TABLE} ENABLE ROW LEVEL SECURITY;
    `);
    // Gösterge aralığı da düzenlenebilir olduğundan sınırlar eşiklerle aynı
    // satırda tutulur. Sütunlar sonradan eklendi: eski satırlarda NULL kalır,
    // aşağıdaki backfill onları fields.js'teki fabrika aralığına çeker.
    await pool.query(`
      ALTER TABLE ${THRESHOLD_TABLE} ADD COLUMN IF NOT EXISTS min_degeri DOUBLE PRECISION;
      ALTER TABLE ${THRESHOLD_TABLE} ADD COLUMN IF NOT EXISTS max_degeri DOUBLE PRECISION;
    `);

    for (const field of GAUGE_FIELDS) {
      const warning = field.zones.find((zone) => zone.level === 'normal')?.to ?? field.min;
      const critical = field.zones.find((zone) => zone.level === 'warning')?.to ?? field.max;
      await pool.query(
        `INSERT INTO ${THRESHOLD_TABLE}
           (box_id, alan_anahtari, uyari_degeri, kritik_degeri,
            min_degeri, max_degeri, guncelleyen_kullanici)
         VALUES ($1, $2, $3, $4, $5, $6, 'sistem-varsayilani')
         ON CONFLICT (box_id, alan_anahtari) WHERE gecerli_bitis IS NULL
         DO NOTHING`,
        [boxId, field.key, warning, critical, field.min, field.max]
      );
      await pool.query(
        `UPDATE ${THRESHOLD_TABLE}
         SET min_degeri = COALESCE(min_degeri, $3),
             max_degeri = COALESCE(max_degeri, $4)
         WHERE box_id = $1 AND alan_anahtari = $2
           AND (min_degeri IS NULL OR max_degeri IS NULL)`,
        [boxId, field.key, field.min, field.max]
      );
    }
    const activeThresholds = await pool.query(
      `SELECT alan_anahtari, uyari_degeri, kritik_degeri, min_degeri, max_degeri
       FROM ${THRESHOLD_TABLE}
       WHERE box_id = $1 AND gecerli_bitis IS NULL`,
      [boxId]
    );
    thresholdCache.clear();
    for (const row of activeThresholds.rows) {
      thresholdCache.set(row.alan_anahtari, {
        warning: Number(row.uyari_degeri),
        critical: Number(row.kritik_degeri),
        min: Number(row.min_degeri),
        max: Number(row.max_degeri),
      });
    }

    // Supabase public şemasındaki tabloları otomatik REST API üzerinden
    // yayınlar; RLS kapalıyken tablo anon anahtarını bilen herkese açık olur.
    // Politika tanımlamadan RLS açmak bu erişimi kapatır. Köprü etkilenmez:
    // tabloyu oluşturan rol sahibi olduğu için RLS'i atlar.
    await pool.query(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);

    dbReady = true;
    dbError = null;
    console.log(`[KÖPRÜ] Veritabanı hazır: ${TABLE} (${FIELD_KEYS.length} alan sütunu)`);
  } catch (e) {
    dbError = e.message;
    console.error('[KÖPRÜ] Veritabanı hazırlanamadı:', e.message);
    console.error('[KÖPRÜ] Geçmiş kaydı devre dışı; canlı izleme etkilenmez.');
  }
}

// Kayıtlar süresiz saklanır; otomatik silme/temizleme yoktur.

const INSERT_SQL = `
  INSERT INTO ${TABLE} (zaman, box_id, ${FIELD_KEYS.map(q).join(', ')})
  VALUES ($1, $2, ${FIELD_KEYS.map((_, i) => `$${i + 3}`).join(', ')})
  ON CONFLICT (box_id, zaman) DO NOTHING
`;
let sampleWriteQueue = Promise.resolve();

function numberOrNull(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'object') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function recordSample(value, atMs) {
  if (!dbReady || atMs - lastSampleAt < historySampleMs) return;
  lastSampleAt = atMs;

  const at = new Date(atMs);
  const params = [at, boxId, ...FIELD_KEYS.map((k) => numberOrNull(value[k]))];
  // MQTT dinleyicisi beklemez; yazmalar kendi kuyruğunda sıralı işlenir.
  sampleWriteQueue = sampleWriteQueue.then(async () => {
    try {
      await pool.query(INSERT_SQL, params);
      lastWriteAt = atMs;
    } catch (e) {
      dbError = e.message;
      console.error('[KÖPRÜ] Örnek yazılamadı:', e.message);
    }
  });
}

// Barındırma sağlayıcısı çalışan sürümün commit'ini ortam değişkeniyle verir.
// /health bunu yansıtır: "deploy gerçekten yeni kodu mu aldı" sorusu böylece
// tahminle değil bakarak yanıtlanır. Yerelde tanımsızdır.
const commitSha = (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || null;

app.get('/health', (_req, res) =>
  res.json({
    ...lastState.connection,
    commit: commitSha,
    fieldCount: FIELD_KEYS.length,
    history: {
      enabled: historyEnabled,
      ready: dbReady,
      error: dbError,
      sampleMs: historySampleMs,
      lastWriteAt: lastWriteAt ? new Date(lastWriteAt).toISOString() : null,
    },
  })
);

app.get('/gauge-thresholds', requireAuth, async (_req, res) => {
  if (!dbReady) {
    res.status(503).json({ error: 'Veritabanı henüz hazır değil.' });
    return;
  }
  try {
    const { rows } = await pool.query(
      `SELECT alan_anahtari, uyari_degeri, kritik_degeri,
              min_degeri, max_degeri, gecerli_baslangic
       FROM ${THRESHOLD_TABLE}
       WHERE box_id = $1 AND gecerli_bitis IS NULL`,
      [boxId]
    );
    res.json({
      thresholds: Object.fromEntries(rows.map((row) => [row.alan_anahtari, {
        warning: Number(row.uyari_degeri),
        critical: Number(row.kritik_degeri),
        // Sınır kaydedilmemişse null gider; istemci fields.js aralığını kullanır.
        min: row.min_degeri === null ? null : Number(row.min_degeri),
        max: row.max_degeri === null ? null : Number(row.max_degeri),
        validFrom: row.gecerli_baslangic.toISOString(),
      }])),
    });
  } catch (e) {
    res.status(500).json({ error: `Gösterge eşikleri okunamadı: ${e.message}` });
  }
});

app.put('/gauge-thresholds/:key', requireAuth, async (req, res) => {
  if (!dbReady || !pool) {
    res.status(503).json({ error: 'Veritabanı henüz hazır değil.' });
    return;
  }
  const field = GAUGE_BY_KEY.get(req.params.key);
  if (!field) {
    res.status(404).json({ error: 'Gösterge bulunamadı.' });
    return;
  }
  const warning = Number(req.body?.warning);
  const critical = Number(req.body?.critical);
  // Aralık gönderilmezse göstergenin kayıtlı sınırları, o da yoksa fields.js
  // tanımı geçerli kalır — eski istemciler yalnızca eşik gönderiyordu.
  const stored = thresholdCache.get(field.key);
  const min = req.body?.min === undefined ? (stored?.min ?? field.min) : Number(req.body.min);
  const max = req.body?.max === undefined ? (stored?.max ?? field.max) : Number(req.body.max);

  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    res.status(400).json({ error: 'Minimum değer maksimum değerden küçük olmalıdır.' });
    return;
  }
  if (
    !Number.isFinite(warning) || !Number.isFinite(critical) ||
    warning <= min || warning >= critical || critical > max
  ) {
    res.status(400).json({
      error: `Değerler ${min} < uyarı < kritik ≤ ${max} sırasına uymalıdır.`,
    });
    return;
  }

  const changedAt = new Date();
  const changedBy = req.user?.email || req.user?.id || 'bilinmeyen-kullanici';
  let dbClient;
  try {
    dbClient = await pool.connect();
    await dbClient.query('BEGIN');
    await dbClient.query(
      `UPDATE ${THRESHOLD_TABLE}
       SET gecerli_bitis = $3
       WHERE box_id = $1 AND alan_anahtari = $2 AND gecerli_bitis IS NULL`,
      [boxId, field.key, changedAt]
    );
    await dbClient.query(
      `INSERT INTO ${THRESHOLD_TABLE}
         (box_id, alan_anahtari, uyari_degeri, kritik_degeri, min_degeri, max_degeri,
          gecerli_baslangic, guncelleyen_kullanici)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [boxId, field.key, warning, critical, min, max, changedAt, changedBy]
    );
    await dbClient.query('COMMIT');
    thresholdCache.set(field.key, { warning, critical, min, max });
    res.json({
      key: field.key,
      warning,
      critical,
      min,
      max,
      validFrom: changedAt.toISOString(),
    });
  } catch (e) {
    await dbClient?.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: `Gösterge eşikleri kaydedilemedi: ${e.message}` });
  } finally {
    dbClient?.release();
  }
});

// GET /history?from=<ISO>&to=<ISO>&keys=a,b&points=1200
//
// Seyreltme veritabanında yapılır: aralıktaki satırlar numaralandırılır ve
// her `adim`inci satır alınır. Satır sayısı `points`in altındaysa adım 1
// olur, yani hiçbir örnek kaybolmaz.
// Geçmişe bakan uçların ortak girişi: tarihleri doğrular, veritabanı hazır
// değilse sebebini söyler. Sorun varsa yanıtı kendisi yazar ve null döner.
function readRange(req, res) {
  const { from, to } = req.query;

  const fromMs = from ? Date.parse(String(from)) : NaN;
  const toMs = to ? Date.parse(String(to)) : NaN;
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    res.status(400).json({ error: 'Geçersiz tarih biçimi (ISO 8601 bekleniyor).' });
    return null;
  }
  if (fromMs > toMs) {
    res.status(400).json({ error: 'Başlangıç, bitişten sonra olamaz.' });
    return null;
  }
  if (!historyEnabled) {
    res.status(503).json({
      error: 'Geçmiş kaydı kapalı: köprüde DATABASE_URL tanımlı değil.',
    });
    return null;
  }
  if (!dbReady) {
    res.status(503).json({
      error: `Veritabanına bağlanılamıyor${dbError ? ` (${dbError})` : ''}.`,
    });
    return null;
  }
  return { fromMs, toMs };
}

app.get('/history', requireAuth, async (req, res) => {
  const { keys, points } = req.query;

  const range = readRange(req, res);
  if (!range) return;
  const { fromMs, toMs } = range;

  // Yalnızca tanıdığımız sütunlar sorgulanır — istek gövdesinden gelen ad
  // doğrudan SQL'e girmesin.
  const requested = keys
    ? String(keys).split(',').map((k) => k.trim()).filter(Boolean)
    : FIELD_KEYS;
  const wanted = requested.filter((k) => FIELD_KEYS.includes(k));
  if (wanted.length === 0) {
    return res.status(400).json({ error: 'Geçerli bir alan adı verilmedi.' });
  }

  const maxPoints = Math.min(Math.max(Number(points) || 1200, 50), 5000);
  const selected = wanted.map(q).join(', ');

  try {
    const [rows, avail] = await Promise.all([
      pool.query(
        `
        WITH aralik AS (
          SELECT zaman, ${selected},
                 row_number() OVER (ORDER BY zaman) - 1 AS sira,
                 count(*) OVER () AS toplam
          FROM ${TABLE}
          WHERE box_id = $1 AND zaman >= $2 AND zaman <= $3
        )
        SELECT zaman, ${selected}
        FROM aralik
        WHERE sira % GREATEST(1, (toplam / $4)::bigint) = 0
        ORDER BY zaman
        `,
        [boxId, new Date(fromMs), new Date(toMs), maxPoints]
      ),
      pool.query(
        `SELECT min(zaman) AS ilk, max(zaman) AS son FROM ${TABLE} WHERE box_id = $1`,
        [boxId]
      ),
    ]);

    const edge = avail.rows[0];
    res.json({
      available:
        edge?.ilk && edge?.son
          ? { from: edge.ilk.toISOString(), to: edge.son.toISOString() }
          : null,
      sampleMs: historySampleMs,
      samples: rows.rows.map((r) => {
        const out = { t: r.zaman.toISOString() };
        for (const k of wanted) if (r[k] !== null && r[k] !== undefined) out[k] = r[k];
        return out;
      }),
    });
  } catch (e) {
    dbError = e.message;
    console.error('[KÖPRÜ] Geçmiş okuma hatası:', e.message);
    res.status(500).json({ error: `Geçmiş okunamadı: ${e.message}` });
  }
});

// GET /report?from=<ISO>&to=<ISO>
//
// "Sondaj Makine Raporu" sekmesinin özeti.
//
// Motorun çalışma süresi iki yoldan biriyle bulunur:
//
//  1. Sayaç farkı (varsayılan): kümülatif sayaç alanının aralık başındaki ve
//     sonundaki değerlerinin farkı. Sayaç yalnızca motor çalışırken ilerler,
//     bu yüzden kayıt boşlukları sonucu bozmaz — sayaç makinenin kendisinde
//     işlemeye devam eder. Tek eksiği çözünürlüğü: sayaç 0,05 saat (3 dakika)
//     adımlarla arttığı için sonuç ±3 dakika oynayabilir.
//
//  2. Kesintisiz çalışma: kayıtlar aralığın başından sonuna kadar eksiksizse
//     ve içlerinde motor devrinin sıfır olduğu tek bir örnek bile yoksa,
//     motor bütün pencere boyunca çalışmış demektir; süre doğrudan kayıt
//     penceresinin uzunluğudur. Böylece 3 dakikalık yuvarlama kaybolur.
//
// İkinci yol yalnızca kapsam tamken uygulanır: kayıt eksikse "hiç durmamış"
// bilgisi yalnızca elimizdeki örnekler için doğrudur, boşlukta ne olduğunu
// bilemeyiz — orada sayaç farkı esastır.
const REPORT_EDGE_TOLERANCE_SEC = 60;
const REPORT_GAP_SEC = 60;

// GET /report-alerts?from=<ISO>&to=<ISO>
//
// Kritik olaylar saklanmaz, üstteki tarih aralığı için her istekte ham
// örneklerden hesaplanır. Tek kaynak olduğu için raporun iki kez farklı sonuç
// vermesi mümkün değildir ve eşik değiştirildiğinde geçmiş de anında yeni eşiğe
// göre okunur.
//
// Bir gösterge kritik eşiğe çıktığında olay başlar; o göstergenin bir sonraki
// kritik örneği REPORT_GAP_SEC'ten geç geliyorsa olay orada kapanır. Yani
// eşiğin altına inip saniyeler içinde geri çıkan bir değer tek bir olay sayılır
// (aynı olayın onlarca satıra bölünmesi engellenir), uzun sessizlikten sonraki
// çıkış ise yeni olaydır. Her olay için ulaşılan en yüksek değer ve zamanı
// döndürülür.
//
// Hız: pencere fonksiyonları yalnızca kritik örnekler üzerinde çalışsın diye
// eşik karşılaştırması iki yerde birden yapılır. Dıştaki OR filtresi hiçbir
// göstergesi kritik olmayan satırları daha örnek tablosu okunurken eler; geriye
// kalan avuç dolusu satır LATERAL ile göstergelere açılır. Böylece maliyet
// aralıktaki toplam örnek sayısıyla değil, kritik örnek sayısıyla büyür.
app.get('/report-alerts', requireAuth, async (req, res) => {
  const range = readRange(req, res);
  if (!range) return;
  const { fromMs, toMs } = range;

  const selected = GAUGE_FIELDS.flatMap((field) => {
    const threshold = thresholdCache.get(field.key)?.critical;
    if (!Number.isFinite(threshold)) return [];
    return [{ ...field, threshold }];
  });
  if (selected.length === 0) {
    // Eşiksiz "uyarı yok" cevabı yanıltıcı olur; sebebi açıkça söylenir.
    res.status(503).json({ error: 'Gösterge eşikleri yüklenmedi; tarama yapılamadı.' });
    return;
  }

  const params = [boxId, new Date(fromMs), new Date(toMs), REPORT_GAP_SEC];
  const columns = [];
  const filters = [];
  for (const field of selected) {
    params.push(field.threshold);
    const thresholdParam = `$${params.length}`;
    const divisor = Number(field.divisor) || 1;
    const valueSql = `o.${q(field.key)} / ${divisor}`;
    columns.push(`('${field.key.replace(/'/g, "''")}', ${valueSql}, ${thresholdParam}::double precision)`);
    filters.push(`${valueSql} >= ${thresholdParam}`);
  }

  try {
    const { rows } = await pool.query(
      `
      WITH tehlikeli AS (
        SELECT o.zaman, v.alan, v.deger, v.esik
        FROM ${TABLE} o
        CROSS JOIN LATERAL (VALUES
          ${columns.join(',\n          ')}
        ) AS v(alan, deger, esik)
        WHERE o.box_id = $1 AND o.zaman >= $2 AND o.zaman <= $3
          AND (${filters.join('\n            OR ')})
          AND v.deger >= v.esik
      ),
      komsulu AS (
        SELECT *, lag(zaman) OVER (PARTITION BY alan ORDER BY zaman) AS onceki_zaman
        FROM tehlikeli
      ),
      isaretli AS (
        SELECT *,
               CASE WHEN onceki_zaman IS NULL
                      OR EXTRACT(EPOCH FROM (zaman - onceki_zaman)) > $4
                    THEN 1 ELSE 0 END AS yeni_olay
        FROM komsulu
      ),
      gruplu AS (
        SELECT *, sum(yeni_olay) OVER (PARTITION BY alan ORDER BY zaman) AS olay_no
        FROM isaretli
      ),
      olaylar AS (
        SELECT alan,
               max(deger) AS maksimum,
               (array_agg(zaman ORDER BY deger DESC, zaman ASC))[1] AS maksimum_zamani,
               max(esik) AS esik
        FROM gruplu
        GROUP BY alan, olay_no
      )
      SELECT alan, maksimum_zamani, maksimum, esik
      FROM olaylar
      ORDER BY maksimum_zamani DESC
      LIMIT 1001
      `,
      params
    );
    const truncated = rows.length > 1000;
    res.json({
      truncated,
      alerts: rows.slice(0, 1000).map((row) => ({
        key: row.alan,
        t: row.maksimum_zamani.toISOString(),
        value: Number(row.maksimum),
        // Olayın hangi sınırı aştığı tabloda ayrı sütunda gösterilir.
        threshold: Number(row.esik),
      })),
    });
  } catch (e) {
    dbError = e.message;
    console.error('[KÖPRÜ] Kritik uyarı hesaplama hatası:', e.message);
    res.status(500).json({ error: `Kritik uyarılar hesaplanamadı: ${e.message}` });
  }
});

app.get('/report', requireAuth, async (req, res) => {
  const range = readRange(req, res);
  if (!range) return;
  const { fromMs, toMs } = range;

  try {
    const { rows } = await pool.query(
      `
      WITH veri AS (
        SELECT zaman,
               ${q(ENGINE_HOURS_KEY)} AS motor_saat,
               ${q(ENGINE_SPEED_KEY)} AS devir,
               ${q(ROTATION_SPEED_KEY)} AS rotasyon,
               ${q(WIRELINE_PRESSURE_KEY)} AS wireline
        FROM ${TABLE}
        WHERE box_id = $1 AND zaman >= $2 AND zaman <= $3
      ),
      adim AS (
        SELECT *,
               EXTRACT(EPOCH FROM (zaman - lag(zaman) OVER (ORDER BY zaman))) AS aralik_sn,
               EXTRACT(EPOCH FROM (lead(zaman) OVER (ORDER BY zaman) - zaman)) AS sonraki_aralik_sn
        FROM veri
      ),
      aktif_rotasyon AS (
        SELECT zaman,
               lag(zaman) OVER (ORDER BY zaman) AS onceki_aktif_zaman
        FROM veri
        WHERE rotasyon >= $5
      ),
      rotasyon_isaretli AS (
        SELECT zaman,
               CASE
                 WHEN onceki_aktif_zaman IS NULL
                   OR EXTRACT(EPOCH FROM (zaman - onceki_aktif_zaman)) > $6
                 THEN 1 ELSE 0
               END AS yeni_manevra
        FROM aktif_rotasyon
      ),
      rotasyon_gruplu AS (
        SELECT zaman,
               sum(yeni_manevra) OVER (ORDER BY zaman) AS manevra_no
        FROM rotasyon_isaretli
      ),
      rotasyon_ozet AS (
        SELECT manevra_no, min(zaman) AS baslangic, max(zaman) AS bitis
        FROM rotasyon_gruplu
        GROUP BY manevra_no
      ),
      aktif_wireline AS (
        SELECT zaman,
               lag(zaman) OVER (ORDER BY zaman) AS onceki_tepe_zamani
        FROM veri
        WHERE wireline >= $8
      ),
      wireline_isaretli AS (
        SELECT zaman,
               CASE
                 WHEN onceki_tepe_zamani IS NULL
                   OR EXTRACT(EPOCH FROM (zaman - onceki_tepe_zamani)) > $9
                 THEN 1 ELSE 0
               END AS yeni_tepe
        FROM aktif_wireline
      ),
      wireline_ozet AS (
        SELECT sum(yeni_tepe)::int AS tepe_adet
        FROM wireline_isaretli
      ),
      rotasyon_komsulari AS (
        SELECT *,
               max(CASE WHEN rotasyon >= $5 THEN zaman END) OVER (
                 ORDER BY zaman ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ) AS onceki_aktif_zaman,
               -- Sonraki aktif zaman, "sonrasına bakan" bir çerçeve yerine ters
               -- sıralı ve büyüyen bir çerçeveyle bulunur. İkisi de aynı satır
               -- kümesini (zaman > bu satır) kapsar, ama min() tersinir olmadığı
               -- için başlangıcı ilerleyen çerçeve her satırda baştan hesaplanır
               -- (O(n²)); büyüyen çerçeve tek geçişte biter.
               min(CASE WHEN rotasyon >= $5 THEN zaman END) OVER (
                 ORDER BY zaman DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ) AS sonraki_aktif_zaman
        FROM adim
      ),
      operasyon_sureleri AS (
        SELECT
          coalesce(sum(sonraki_aralik_sn) FILTER (
            WHERE rotasyon > $7 AND rotasyon < $5
              AND sonraki_aralik_sn <= $4
              AND sonraki_aktif_zaman IS NOT NULL
              AND (
                onceki_aktif_zaman IS NULL
                OR EXTRACT(EPOCH FROM (sonraki_aktif_zaman - onceki_aktif_zaman)) > $6
                   AND EXTRACT(EPOCH FROM (sonraki_aktif_zaman - zaman))
                       < EXTRACT(EPOCH FROM (zaman - onceki_aktif_zaman))
              )
          ), 0) AS oncesi_saniye,
          coalesce(sum(sonraki_aralik_sn) FILTER (
            WHERE rotasyon > $7 AND rotasyon < $5
              AND sonraki_aralik_sn <= $4
              AND onceki_aktif_zaman IS NOT NULL
              AND (
                sonraki_aktif_zaman IS NULL
                OR EXTRACT(EPOCH FROM (sonraki_aktif_zaman - onceki_aktif_zaman)) > $6
                   AND EXTRACT(EPOCH FROM (zaman - onceki_aktif_zaman))
                       <= EXTRACT(EPOCH FROM (sonraki_aktif_zaman - zaman))
              )
          ), 0) AS sonrasi_saniye
        FROM rotasyon_komsulari
      )
      SELECT
        count(*)::int AS adet,
        min(zaman) AS ilk_zaman,
        max(zaman) AS son_zaman,
        count(*) FILTER (WHERE devir IS NOT NULL)::int AS devirli_adet,
        count(*) FILTER (WHERE devir = 0)::int AS durus_adet,
        count(*) FILTER (WHERE aralik_sn > $4)::int AS bosluk_adet,
        coalesce(sum(aralik_sn) FILTER (WHERE aralik_sn > $4), 0) AS bosluk_sn,
        (SELECT count(*)::int FROM rotasyon_ozet) AS manevra_adet,
        (SELECT coalesce(tepe_adet, 0) FROM wireline_ozet) AS wireline_tepe_adet,
        (SELECT coalesce(sum(EXTRACT(EPOCH FROM (bitis - baslangic))), 0)
         FROM rotasyon_ozet) AS verimli_saniye,
        (SELECT oncesi_saniye FROM operasyon_sureleri) AS operasyon_oncesi_saniye,
        (SELECT sonrasi_saniye FROM operasyon_sureleri) AS operasyon_sonrasi_saniye,
        (SELECT motor_saat FROM veri WHERE motor_saat IS NOT NULL ORDER BY zaman ASC LIMIT 1) AS ilk_saat,
        (SELECT motor_saat FROM veri WHERE motor_saat IS NOT NULL ORDER BY zaman DESC LIMIT 1) AS son_saat
      FROM adim
      `,
      [
        boxId,
        new Date(fromMs),
        new Date(toMs),
        REPORT_GAP_SEC,
        ROTATION_ACTIVE_RPM,
        ROTATION_RESTART_GAP_SEC,
        ROTATION_OPERATION_MIN_RPM,
        WIRELINE_PEAK_BAR,
        WIRELINE_PEAK_RESTART_GAP_SEC,
      ]
    );

    const r = rows[0];
    const hasData = r.adet > 0;
    const first = r.ilk_saat === null ? null : Number(r.ilk_saat);
    const last = r.son_saat === null ? null : Number(r.son_saat);

    const firstAtMs = hasData ? r.ilk_zaman.getTime() : null;
    const lastAtMs = hasData ? r.son_zaman.getTime() : null;
    const gapSec = Number(r.bosluk_sn) || 0;
    const efficientSeconds = Number(r.verimli_saniye) || 0;
    const beforeOperationSeconds = Number(r.operasyon_oncesi_saniye) || 0;
    const afterOperationSeconds = Number(r.operasyon_sonrasi_saniye) || 0;

    // Kayıtların aralığı ne kadar kapladığı: uçlardaki eksikler ve aradaki
    // boşluklar düşülür.
    const windowSec = (toMs - fromMs) / 1000;
    const coveredSec = hasData
      ? Math.max(0, (lastAtMs - firstAtMs) / 1000 - gapSec)
      : 0;
    const coverageRatio = windowSec > 0 ? Math.min(1, coveredSec / windowSec) : 0;

    // Kapsam tam mı: kayıtlar pencerenin iki ucuna da yetişiyor ve arada
    // kopukluk yok.
    const edgesOk =
      hasData &&
      (firstAtMs - fromMs) / 1000 <= REPORT_EDGE_TOLERANCE_SEC &&
      (toMs - lastAtMs) / 1000 <= REPORT_EDGE_TOLERANCE_SEC;
    const complete = edgesOk && r.bosluk_adet === 0;
    const nonstop = complete && r.devirli_adet > 0 && r.durus_adet === 0;

    const counterHours =
      first !== null && last !== null ? Math.max(0, last - first) : null;
    const nonstopHours = hasData ? (lastAtMs - firstAtMs) / 3600000 : null;

    const engineHours = nonstop ? nonstopHours : counterHours;

    res.json({
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
      sampleCount: r.adet,
      coverage: hasData
        ? {
            from: r.ilk_zaman.toISOString(),
            to: r.son_zaman.toISOString(),
            ratio: coverageRatio,
            complete,
            gapCount: r.bosluk_adet,
            gapSeconds: gapSec,
          }
        : null,
      engineHours,
      // Hangi yolla bulunduğu arayüzde gizlense de tanı için önemli.
      engineHoursMethod: engineHours === null ? null : nonstop ? 'nonstop' : 'counter',
      engineCounter: first !== null && last !== null ? { first, last } : null,
      idleSamples: r.durus_adet,
      speedSamples: r.devirli_adet,
      maneuverCount: r.manevra_adet,
      wirelinePeakCount: r.wireline_tepe_adet,
      beforeOperationHours: beforeOperationSeconds / 3600,
      afterOperationHours: afterOperationSeconds / 3600,
      efficientHours: efficientSeconds / 3600,
      lostHours: Math.max(0, (toMs - fromMs) / 3600000 - efficientSeconds / 3600),
    });
  } catch (e) {
    dbError = e.message;
    console.error('[KÖPRÜ] Rapor okuma hatası:', e.message);
    res.status(500).json({ error: `Rapor hesaplanamadı: ${e.message}` });
  }
});

initDb();

// --- MQTT bağlantısı ---
console.log(`[KÖPRÜ] Broker'a bağlanılıyor: ${brokerUrl}  (kullanıcı: ${MQTT_USERNAME})`);

const client = mqtt.connect(brokerUrl, {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  rejectUnauthorized: String(MQTT_REJECT_UNAUTHORIZED).toLowerCase() === 'true',
  reconnectPeriod: 3000,
  connectTimeout: 15000,
  clientId: `mta_dashboard_${Math.random().toString(16).slice(2, 10)}`,
});

let analogRequestTimer = null;

function requestAnalogData() {
  if (!client.connected) return;
  client.publish(analogRequestTopic, JSON.stringify({ box_id: boxId }), { qos: 0 });
}

client.on('connect', () => {
  lastState.connection = { ...lastState.connection, connected: true, error: null };
  console.log(`[KÖPRÜ] MQTT bağlantısı kuruldu. Hedef cihaz: box_id ${boxId}`);
  client.subscribe([MQTT_TOPIC, analogResponseTopic], (err) => {
    if (err) console.error('[KÖPRÜ] Abonelik hatası:', err.message);
    else {
      console.log(`[KÖPRÜ] Abone olunan topic'ler: ${MQTT_TOPIC}, ${analogResponseTopic}`);
      clearInterval(analogRequestTimer);
      requestAnalogData();
      analogRequestTimer = setInterval(requestAnalogData, analogRequestIntervalMs);
    }
  });
  io.emit('connection-status', lastState.connection);
});

client.on('reconnect', () => console.log('[KÖPRÜ] Yeniden bağlanılıyor...'));

client.on('error', (err) => {
  lastState.connection = { ...lastState.connection, connected: false, error: err.message };
  console.error('[KÖPRÜ] MQTT hatası:', err.message);
  io.emit('connection-status', lastState.connection);
});

client.on('close', () => {
  clearInterval(analogRequestTimer);
  analogRequestTimer = null;
  lastState.connection = { ...lastState.connection, connected: false };
  io.emit('connection-status', lastState.connection);
});

client.on('message', (topic, payloadBuf) => {
  let value;
  try {
    value = JSON.parse(payloadBuf.toString());
  } catch {
    return; // JSON olmayan mesajlar bu arayüzü ilgilendirmiyor
  }

  // Aynı topic'e onlarca cihaz yayın yapıyor: yalnızca hedef box_id süzülür.
  if (!value || typeof value !== 'object' || Number(value.box_id) !== boxId) return;

  // Bu akış yalnızca canlı Makine Verileri sayfasına gider. Geçmiş kayda,
  // konuma, motor veya dijital verilere dokunmaz.
  if (topic === analogResponseTopic && Array.isArray(value.values)) {
    const analogPacket = {
      topic,
      boxId,
      value: Object.fromEntries(
        value.values.map((item, index) => [`AnalogData${index + 1}`, item])
      ),
      receivedAt: new Date().toISOString(),
    };
    lastState.analogData = analogPacket;
    io.emit('resAnalogData', analogPacket);
    return;
  }

  const packet = {
    topic,
    boxId,
    value,
    receivedAt: new Date().toISOString(),
  };

  lastState.data = packet;
  recordSample(value, Date.parse(packet.receivedAt));
  if (!lastState.connection.dataSeen) {
    lastState.connection = { ...lastState.connection, dataSeen: true };
    io.emit('connection-status', lastState.connection);
  }
  io.emit('resData', packet);
});

// --- Yeni arayüz bağlandığında son durumu gönder ---
io.on('connection', (socket) => {
  console.log('[KÖPRÜ] Arayüz bağlandı:', socket.id, '-', socket.data.user?.email || '?');
  socket.emit('connection-status', lastState.connection);
  if (lastState.data) socket.emit('resData', lastState.data);
  if (lastState.analogData) socket.emit('resAnalogData', lastState.analogData);
});

httpServer.listen(listenPort, () => {
  console.log(`[KÖPRÜ] Socket.IO sunucusu çalışıyor: http://localhost:${listenPort}`);
});
