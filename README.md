# MTA Dashboard

Hoytek-IOT MQTT yayınından **box_id 20** numaralı sondaj makinesinin verilerini
canlı izleyen arayüz. Yapı olarak DTS Demo ile aynıdır: bir Node.js köprüsü
broker'a bağlanır, React arayüz Socket.IO üzerinden veriyi alır.

```
Broker (mqtts://temelsondajtakip.com:8883)
        │  topic: Hoytek-IOT/   (tüm cihazlar aynı topic'e yayın yapar)
        ▼
   server.js  ── box_id === 59 süzgeci ──►  Socket.IO
        ▼
   React arayüz (Vite, :5174)
```

## Kurulum

```bash
npm install
```

`.env.example` dosyasını `.env` olarak kopyalayıp broker bilgilerini girin.

## Çalıştırma

```bash
npm run dev
```

- Köprü sunucusu: `http://localhost:4001` (sağlık kontrolü: `/health`)
- Arayüz: `http://localhost:5174`

Yalnızca birini çalıştırmak için `npm run server` / `npm run ui`.

## Sekmeler

| Sekme | İçerik |
| --- | --- |
| **Makine Verileri** | `AnalogData1..16` → radyal göstergeler (`AnalogData12` kullanılmıyor) |
| **Motor Verileri** | Voltaj / Üretici Kodu / Çalışma Saati özet kartları + CAN motor göstergeleri |
| **Dijital Makine Verileri** | Rotasyon Devir & SPT Vuruş göstergeleri + dijital durum kutucukları |
| **Geçmiş Grafik** | Tarih aralığı seçip tek alanın zaman serisini çizer |
| **Konum** | `Vehicle_Location_Lat/Lon` → Google Hybrid harita |

## Geçmiş Grafik

Köprü, gelen paketlerden en fazla `HISTORY_SAMPLE_MS` (varsayılan 5 sn) aralıkla
örnek alıp **PostgreSQL**'e yazar. Arayüz bu geçmişi
`GET /history?from=&to=&keys=&points=` ucundan çeker; sonuç grafik için ~1200
noktaya seyreltilir ve veri akışının kesildiği aralıklarda çizgi kopar.

Kayıt tarayıcıdan bağımsızdır: yazan taraf MQTT'ye abone olan köprü sürecidir,
**sayfa hiç açılmasa da** köprü ayakta olduğu sürece kayıt sürer.

### Kurulum

`.env` içine bağlantı adresini yazmak yeterlidir:

```
DATABASE_URL=postgres://kullanici:sifre@localhost:5432/mta
```

`sondaj_ornekleri` tablosu ve alan sütunları köprü açılışında otomatik
oluşturulur; elle SQL çalıştırmak gerekmez. `src/config/fields.js` dosyasına
yeni bir alan eklenirse, köprü yeniden başlatıldığında sütun da eklenir.

| Sütun | Tip |
| --- | --- |
| `zaman` | `TIMESTAMPTZ` |
| `box_id` | `INTEGER` |
| `AnalogData1` … `AuxData8` | `DOUBLE PRECISION` |

Birincil anahtar `(box_id, zaman)` — hem tekilliği sağlar hem de aralık
sorgularının kullandığı indekstir.

`DATABASE_URL` boş bırakılırsa geçmiş kaydı kapanır; canlı izleme (MQTT →
Socket.IO) veritabanından bağımsız çalışmaya devam eder ve Geçmiş Grafik sekmesi
durumu açıkça bildirir. Veritabanı sonradan erişilemez hale gelirse de köprü
çökmez, yalnızca geçmiş kaydı durur.

`HISTORY_RETENTION_DAYS` varsayılan olarak `0`'dır (sınırsız saklama). Pozitif
bir değer verilirse o günden eski satırlar günde bir **silinir**.

## Veri kesintisi

Araçtan **15 saniye** boyunca yeni paket gelmezse arayüz tüm değerleri
`Veri Yok` olarak gösterir ve üst bardaki **Araç Durumu** rozeti `Pasif`e döner.
Veri yeniden akmaya başladığında sayfa yenilemeden normale döner. Süre
`src/App.jsx` içindeki `STALE_MS` sabitiyle değiştirilir.

## Tema

Üst bardaki görünüm düğmesine tıklanınca altında üç seçenek açılır; düğme o an
seçili modun ikonunu taşır. Seçim tarayıcıda saklanır ve sayfa açılışında
boyanmadan önce uygulanır.

| Mod | id | Davranış |
| --- | --- | --- |
| Sistem | `system` | Cihazın `prefers-color-scheme` ayarını izler |
| Koyu (varsayılan) | `dark` | Nötr gri zemin, amber vurgu |
| Açık | `light` | Beyaz zemin, lacivert vurgu |

`system` bir palet değil, bir tercihtir: `<html data-theme>` özniteliğine her
zaman çözümlenmiş palet (`dark` ya da `light`) yazılır, böylece CSS tarafında
ek bir kural gerekmez. Sistem modundayken işletim sistemi ayarı değişirse
arayüz sayfa yenilemeden birlikte değişir.

**Açık** tek aydınlık temadır. Koyu temada doğal olan bazı değerlerin
(beyaz alfa dolgular, ağır gölgeler, açık ton bölge renkleri) beyaz üzerinde
karşılığı yoktur; bu yüzden `--gauge-track`, `--neutral-*`, `--shadow-*`,
`--zone-*` ve `--ok`/`--off` bu temada ayrıca ezilir. Renkler beyaz zeminde
WCAG AA (4.5:1) eşiğini geçecek şekilde seçilmiştir.

Mod listesi ve varsayılan iki yerde geçer, **birlikte güncellenmelidir**:
[`src/config/themes.js`](src/config/themes.js) ve `index.html` içindeki açılış
script'i. Tanınmayan bir kayıt (örn. kaldırılmış bir mod) yok sayılır,
varsayılana düşülür.

Arayüzdeki **her renk** `src/styles.css` başındaki CSS değişkenlerinden gelir;
bir paleti değiştirmek için ilgili `:root[data-theme='<id>']` bloğunu düzenlemek
yeterlidir.

Bilinçli olarak temadan bağımsız tutulanlar:

- **Gösterge bölgeleri** (yeşil/sarı/kırmızı): renk değil anlam taşır —
  Normal / Uyarı / Tehlike. Yine de bir tema gerekirse `--zone-*`
  değişkenlerini ezebilir (Açık tema bunu kontrast için yapar).
- **MTA amblemi**: kurum kimliği.
- **Harita işaretçisinin beyaz çerçevesi**: uydu görüntüsünde kontrast için.

## Logo

Kurumun gerçek amblemini `public/logo.png` olarak kaydederseniz otomatik
kullanılır. Dosya yoksa `src/components/Logo.jsx` içindeki SVG amblem gösterilir.

## Alan tanımları

Etiketler, birimler, gösterge aralıkları ve Normal/Uyarı/Tehlike eşiklerinin
tamamı tek dosyada: [`src/config/fields.js`](src/config/fields.js). Bir eşiği
veya ismi değiştirmek için yalnızca bu dosya düzenlenir.

### AuxData eşleştirmesi

| Alan | Gösterim |
| --- | --- |
| `AuxData1` | Rotasyon Devir (gösterge) |
| `AuxData2` | SPT Vuruş (gösterge) |
| `AuxData3` | Hidrolik Sıcaklık |
| `AuxData4` | Filtre 1 |
| `AuxData5` | Filtre 2 |
| `AuxData6` | Hidrolik Seviye |
| `AuxData7` | Acil Stop |
| `AuxData8` | Morsed Yağlama |

`AuxData9`–`AuxData16` kullanılmıyor ve arayüzde hiç gösterilmez.

## Topic notu

Broker'daki gerçek topic adı sonunda eğik çizgi taşıyor: `Hoytek-IOT/`.
MQTT Explorer bunu `Hoytek-IOT` gibi gösterdiği için, yalnızca `Hoytek-IOT`
adresine abone olan istemciler **hiç mesaj alamaz**. Bu yüzden varsayılan
abonelik `Hoytek-IOT/#` şeklindedir (her iki varyantı da yakalar).
