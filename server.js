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
  HISTORY_SAMPLE_MS = '10000',
  // postgres://kullanici:sifre@sunucu:5432/veritabani
  // Tanımlı değilse geçmiş kaydı kapalıdır; canlı izleme normal çalışır.
  DATABASE_URL = '',
  // Barındırılan Postgres'lerin çoğu TLS ister (Neon, Supabase, Railway...).
  DATABASE_SSL = 'false',
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
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: allowedOrigins } });

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
const historySampleMs = Math.max(Number(HISTORY_SAMPLE_MS) || 10000, 250);

const TABLE = 'sondaj_ornekleri';
const FIELD_KEYS = [...new Set(FIELDS.filter((f) => f.key).map((f) => f.key))];
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

function numberOrNull(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'object') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function recordSample(value, atMs) {
  if (!dbReady || atMs - lastSampleAt < historySampleMs) return;
  lastSampleAt = atMs;

  const params = [new Date(atMs), boxId, ...FIELD_KEYS.map((k) => numberOrNull(value[k]))];
  // Yazma beklenmez: MQTT akışı veritabanı gecikmesine takılmasın.
  pool.query(INSERT_SQL, params).then(
    () => {
      lastWriteAt = atMs;
    },
    (e) => {
      dbError = e.message;
      console.error('[KÖPRÜ] Örnek yazılamadı:', e.message);
    }
  );
}

app.get('/health', (_req, res) =>
  res.json({
    ...lastState.connection,
    history: {
      enabled: historyEnabled,
      ready: dbReady,
      error: dbError,
      sampleMs: historySampleMs,
      lastWriteAt: lastWriteAt ? new Date(lastWriteAt).toISOString() : null,
    },
  })
);

// GET /history?from=<ISO>&to=<ISO>&keys=a,b&points=1200
//
// Seyreltme veritabanında yapılır: aralıktaki satırlar numaralandırılır ve
// her `adim`inci satır alınır. Satır sayısı `points`in altındaysa adım 1
// olur, yani hiçbir örnek kaybolmaz.
app.get('/history', async (req, res) => {
  const { from, to, keys, points } = req.query;

  const fromMs = from ? Date.parse(String(from)) : NaN;
  const toMs = to ? Date.parse(String(to)) : NaN;
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return res.status(400).json({ error: 'Geçersiz tarih biçimi (ISO 8601 bekleniyor).' });
  }
  if (fromMs > toMs) {
    return res.status(400).json({ error: 'Başlangıç, bitişten sonra olamaz.' });
  }
  if (!historyEnabled) {
    return res.status(503).json({
      error: 'Geçmiş kaydı kapalı: köprüde DATABASE_URL tanımlı değil.',
    });
  }
  if (!dbReady) {
    return res.status(503).json({
      error: `Veritabanına bağlanılamıyor${dbError ? ` (${dbError})` : ''}.`,
    });
  }

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
  console.log('[KÖPRÜ] Arayüz bağlandı:', socket.id);
  socket.emit('connection-status', lastState.connection);
  if (lastState.data) socket.emit('resData', lastState.data);
  if (lastState.analogData) socket.emit('resAnalogData', lastState.analogData);
});

httpServer.listen(listenPort, () => {
  console.log(`[KÖPRÜ] Socket.IO sunucusu çalışıyor: http://localhost:${listenPort}`);
});
