// ---------------------------------------------------------------------------
// Hoytek-IOT paketindeki alanların tek merkezi tanımı.
//
// Her alan; Türkçe etiketi, birimi, hangi sekmede görüneceği ve nasıl
// çizileceği (radyal gösterge / üst bilgi kartı / dijital kutucuk) ile birlikte
// burada tanımlanır. Arayüzdeki tüm bileşenler bu dosyayı kaynak alır, yani
// bir eşiği ya da etiketi değiştirmek için yalnızca burası düzenlenir.
// ---------------------------------------------------------------------------

// Gösterge bölgeleri renk değil "seviye" taşır; gerçek renkler CSS'te
// --zone-normal / --zone-warning / --zone-danger değişkenlerinden gelir.
// Böylece tema değiştiğinde bölge renkleri de birlikte güncellenebilir.
export const ZONE_LEGEND = [
  { level: 'normal', label: 'Normal' },
  { level: 'warning', label: 'Uyarı' },
  { level: 'danger', label: 'Tehlike' },
];

// Normal → Uyarı → Tehlike sınırlarını kısa yazmak için yardımcı.
const zones = (normalTo, warningTo, dangerTo) => [
  { to: normalTo, level: 'normal' },
  { to: warningTo, level: 'warning' },
  { to: dangerTo, level: 'danger' },
];

// "Rotasyon Devir" göstergesinin kaynağı.
export const ROTASYON_DEVIR_KEY = 'AuxData1';

export const CATEGORIES = [
  { id: 'makine', title: 'Makine Verileri' },
  { id: 'motor', title: 'Motor Verileri' },
  { id: 'dijital', title: 'Dijital Makine Verileri' },
];

// --- Makine Verileri (AnalogData1..16) ------------------------------------
const MACHINE_FIELDS = [
  { key: 'AnalogData1', tr: 'Ana Pompa Basıncı', min: 0, max: 340, zones: zones(255, 290, 340) },
  { key: 'AnalogData2', tr: 'Servis Pompası', min: 0, max: 250, zones: zones(190, 215, 250) },
  { key: 'AnalogData3', tr: 'Servis Pompa Basıncı', min: 0, max: 250, zones: zones(190, 212, 250) },
  { key: 'AnalogData4', tr: 'Rotasyon Tork', min: 0, max: 270, zones: zones(205, 232, 270) },
  { key: 'AnalogData5', tr: 'Baskı Basıncı', min: 0, max: 270, zones: zones(205, 232, 270) },
  { key: 'AnalogData6', tr: 'Askı Basıncı', min: 0, max: 50, zones: zones(20, 27, 50), tickDecimals: 1 },
  { key: 'AnalogData7', tr: 'Wireline Winç', min: 0, max: 320, zones: zones(240, 275, 320) },
  { key: 'AnalogData8', tr: 'Ana Vinç', min: 0, max: 320, zones: zones(240, 275, 320) },
  { key: 'AnalogData9', tr: 'Vireline Vinç', min: 0, max: 320, zones: zones(230, 242, 320) },
  { key: 'AnalogData10', tr: 'Çamur Su Basıncı', min: 0, max: 320, zones: zones(225, 250, 320) },
  { key: 'AnalogData11', tr: 'Rotasyon İlerleme', min: 0, max: 350, zones: zones(330, 342, 350) },
  // Ölçek ve eşikler henüz bilinmiyor: aralık 0–100 varsayıldı ve tek bir
  // "normal" bant verildi ki gösterge uydurma Uyarı/Tehlike rengi göstermesin.
  { key: 'AnalogData12', tr: 'Su Litre', min: 0, max: 100, zones: [{ to: 100, level: 'normal' }] },
  { key: 'AnalogData13', tr: 'Makine Roll', min: -90, max: 90, zones: zones(55, 70, 90) },
  { key: 'AnalogData14', tr: 'Makine Pitch', min: -90, max: 90, zones: zones(55, 70, 90) },
  { key: 'AnalogData15', tr: 'Kule Roll', min: -90, max: 90, zones: zones(55, 70, 90) },
  { key: 'AnalogData16', tr: 'Kule Pitch', min: -90, max: 90, zones: zones(55, 70, 90) },
].map((f) => ({ ...f, category: 'makine', kind: 'gauge', unit: '', decimals: 2 }));

// --- Motor Verileri: göstergelerin üstündeki özet kartları ----------------
const MOTOR_STATS = [
  {
    key: 'CAN_Battery_Potential',
    tr: 'Voltaj',
    unit: 'V',
    decimals: 2,
    icon: 'bolt',
    tone: 'amber',
  },
  {
    key: 'CAN_Manufacturer_Code',
    tr: 'Üretici Kodu',
    unit: '',
    decimals: 0,
    icon: 'chip',
    tone: 'crimson',
  },
  {
    key: 'CAN_Engine_Total_Hours_Of_Operation',
    tr: 'Sondaj Makinesi Çalışma Saati',
    unit: 'sa',
    decimals: 2,
    icon: 'clock',
    tone: 'ember',
  },
].map((f) => ({ ...f, category: 'motor', kind: 'stat' }));

// --- Motor Verileri: radyal göstergeler -----------------------------------
const MOTOR_GAUGES = [
  { key: 'CAN_Engine_Speed', tr: 'Motor Devri', unit: '', min: 0, max: 2600, zones: zones(2350, 2500, 2600) },
  { key: 'CAN_Engine_Oil_Pressure', tr: 'Motor Yağ Basıncı', unit: 'BAR', min: 0, max: 100, zones: zones(70, 85, 100) },
  { key: 'CAN_Engine_Coolant_Temperature', tr: 'Motor Hararet', unit: '°C', min: 0, max: 150, zones: zones(105, 125, 150) },
  { key: 'CAN_Engine_Oil_Temperature', tr: 'Motor Yağ Sıcaklığı', unit: '°C', min: 0, max: 150, zones: zones(105, 125, 150) },
  { key: 'CAN_Fuel_Level_1', tr: 'Yakıt Seviyesi 1', unit: '%', min: 0, max: 100, zones: zones(70, 85, 100) },
  { key: 'CAN_Fuel_Level_2', tr: 'Yakıt Seviyesi 2', unit: '%', min: 0, max: 100, zones: zones(70, 85, 100) },
  { key: 'CAN_Engine_Fuel_Temperature', tr: 'Mazot Sıcaklığı', unit: '°C', min: 0, max: 220, zones: zones(200, 212, 220) },
].map((f) => ({ ...f, category: 'motor', kind: 'gauge', decimals: 2 }));

// --- Dijital Makine Verileri: radyal göstergeler --------------------------
const DIGITAL_GAUGES = [
  {
    key: ROTASYON_DEVIR_KEY,
    tr: 'Rotasyon Devir',
    unit: 'devir',
    min: 0,
    max: 1300,
    zones: zones(1250, 1280, 1300),
  },
  {
    key: 'AuxData2',
    tr: 'SPT Vuruş',
    unit: 'vuruş',
    min: 0,
    max: 50,
    tickDecimals: 1,
    zones: [
      { to: 40, level: 'normal' },
      { to: 50, level: 'warning' },
    ],
  },
].map((f) => ({ ...f, category: 'dijital', kind: 'gauge', decimals: 2 }));

// --- Dijital Makine Verileri: durum kutucukları ---------------------------
const DIGITAL_BOXES = [
  { key: 'AuxData3', tr: 'Hidrolik Sıcaklık' },
  { key: 'AuxData4', tr: 'Filtre 1' },
  { key: 'AuxData5', tr: 'Filtre 2' },
  { key: 'AuxData6', tr: 'Hidrolik Seviye' },
  { key: 'AuxData7', tr: 'Acil Stop' },
  { key: 'AuxData8', tr: 'Morsed Yağlama' },
].map((f) => ({ ...f, category: 'dijital', kind: 'digital', unit: '', decimals: 0 }));

export const FIELDS = [
  ...MACHINE_FIELDS,
  ...MOTOR_STATS,
  ...MOTOR_GAUGES,
  ...DIGITAL_GAUGES,
  ...DIGITAL_BOXES,
];

// Sekme + çizim türüne göre alanları döndürür (arayüz sırası korunur).
export function fieldsOf(categoryId, kind) {
  return FIELDS.filter((f) => f.category === categoryId && f.kind === kind);
}
