-- ---------------------------------------------------------------------------
-- MTA Dashboard — geçmiş örnekleri tablosu
--
-- Bu dosyayı çalıştırmak ZORUNLU DEĞİLDİR: köprü (server.js) açılışta tabloyu
-- ve eksik sütunları kendisi oluşturur. Şemayı elle kurmak, gözden geçirmek
-- veya sürüm kontrolünde tutmak isteyenler için buradadır.
--
-- Sütunlar src/config/fields.js dosyasındaki alan tanımlarından üretilmiştir.
-- Oraya yeni bir alan eklenirse köprü yeniden başlatıldığında sütun da eklenir
-- (ALTER TABLE ... ADD COLUMN IF NOT EXISTS).
--
-- Supabase SQL Editor'da olduğu gibi çalıştırılabilir.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sondaj_ornekleri (
  zaman                                 TIMESTAMPTZ NOT NULL,
  box_id                                INTEGER     NOT NULL,
  "AnalogData1"                         DOUBLE PRECISION,
  "AnalogData2"                         DOUBLE PRECISION,
  "AnalogData3"                         DOUBLE PRECISION,
  "AnalogData4"                         DOUBLE PRECISION,
  "AnalogData5"                         DOUBLE PRECISION,
  "AnalogData6"                         DOUBLE PRECISION,
  "AnalogData7"                         DOUBLE PRECISION,
  "AnalogData8"                         DOUBLE PRECISION,
  "AnalogData9"                         DOUBLE PRECISION,
  "AnalogData10"                        DOUBLE PRECISION,
  "AnalogData11"                        DOUBLE PRECISION,
  "AnalogData12"                        DOUBLE PRECISION,
  "AnalogData13"                        DOUBLE PRECISION,
  "AnalogData14"                        DOUBLE PRECISION,
  "AnalogData15"                        DOUBLE PRECISION,
  "AnalogData16"                        DOUBLE PRECISION,
  "CAN_Battery_Potential"               DOUBLE PRECISION,
  "CAN_Manufacturer_Code"               DOUBLE PRECISION,
  "CAN_Engine_Total_Hours_Of_Operation" DOUBLE PRECISION,
  "CAN_Engine_Speed"                    DOUBLE PRECISION,
  "CAN_Engine_Oil_Pressure"             DOUBLE PRECISION,
  "CAN_Engine_Coolant_Temperature"      DOUBLE PRECISION,
  "CAN_Engine_Oil_Temperature"          DOUBLE PRECISION,
  "CAN_Fuel_Level_1"                    DOUBLE PRECISION,
  "CAN_Fuel_Level_2"                    DOUBLE PRECISION,
  "CAN_Engine_Fuel_Temperature"         DOUBLE PRECISION,
  "AuxData1"                            DOUBLE PRECISION,
  "AuxData2"                            DOUBLE PRECISION,
  "AuxData3"                            DOUBLE PRECISION,
  "AuxData4"                            DOUBLE PRECISION,
  "AuxData5"                            DOUBLE PRECISION,
  "AuxData6"                            DOUBLE PRECISION,
  "AuxData7"                            DOUBLE PRECISION,
  "AuxData8"                            DOUBLE PRECISION,
  -- Hem tekilliği sağlar hem de aralık sorgusunun kullandığı indekstir:
  -- WHERE box_id = $1 AND zaman BETWEEN $2 AND $3
  PRIMARY KEY (box_id, zaman)
);

COMMENT ON TABLE public.sondaj_ornekleri IS
  'Hoytek-IOT paketlerinden HISTORY_SAMPLE_MS aralıkla alınan örnekler (Geçmiş Grafik).';

-- ---------------------------------------------------------------------------
-- Satır düzeyi güvenlik
--
-- Supabase, public şemasındaki tabloları otomatik REST API üzerinden yayınlar.
-- RLS kapalıyken bu tablo, projenin anon anahtarını bilen herkese açık olur.
-- Politika tanımlamadan RLS'i açmak API erişimini tamamen kapatır.
--
-- Köprü etkilenmez: tabloyu oluşturan `postgres` rolü sahibi olduğu için RLS'i
-- atlar ve doğrudan Postgres bağlantısıyla yazmaya/okumaya devam eder.
-- ---------------------------------------------------------------------------
ALTER TABLE public.sondaj_ornekleri ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.gosterge_esikleri (
  id BIGSERIAL PRIMARY KEY,
  box_id INTEGER NOT NULL,
  alan_anahtari TEXT NOT NULL,
  uyari_degeri DOUBLE PRECISION NOT NULL,
  kritik_degeri DOUBLE PRECISION NOT NULL,
  -- Göstergenin alt/üst sınırı da arayüzden düzenlenir. Boşsa fields.js'teki
  -- fabrika aralığı geçerlidir; köprü açılışta boş satırları doldurur.
  min_degeri DOUBLE PRECISION,
  max_degeri DOUBLE PRECISION,
  gecerli_baslangic TIMESTAMPTZ NOT NULL DEFAULT now(),
  gecerli_bitis TIMESTAMPTZ,
  guncelleyen_kullanici TEXT
);

-- Tablo daha önce sınır sütunları olmadan kurulduysa:
ALTER TABLE public.gosterge_esikleri ADD COLUMN IF NOT EXISTS min_degeri DOUBLE PRECISION;
ALTER TABLE public.gosterge_esikleri ADD COLUMN IF NOT EXISTS max_degeri DOUBLE PRECISION;

CREATE UNIQUE INDEX IF NOT EXISTS gosterge_esikleri_aktif_idx
  ON public.gosterge_esikleri (box_id, alan_anahtari)
  WHERE gecerli_bitis IS NULL;

ALTER TABLE public.gosterge_esikleri ENABLE ROW LEVEL SECURITY;
