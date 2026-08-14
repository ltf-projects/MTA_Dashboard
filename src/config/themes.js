// ---------------------------------------------------------------------------
// Görünüm modları.
//
// 'dark' ve 'light' birer palettir; gerçek renkleri styles.css içinde
// :root[data-theme='<id>'] bloğunda tanımlıdır.
//
// 'system' bir palet DEĞİL, bir tercihtir: işletim sisteminin koyu/açık
// ayarını izler. <html data-theme> özniteliğine her zaman çözümlenmiş palet
// ('dark' ya da 'light') yazılır, böylece CSS tarafında ekstra bir kural
// gerekmez.
// ---------------------------------------------------------------------------

export const MODES = [
  { id: 'system', name: 'Sistem', note: 'Cihazın görünüm ayarını izler' },
  { id: 'dark', name: 'Koyu', note: 'Nötr gri zemin, amber vurgu' },
  { id: 'light', name: 'Açık', note: 'Beyaz zemin, lacivert vurgu' },
];

export const DEFAULT_MODE = 'dark';
export const STORAGE_KEY = 'mta-theme';
