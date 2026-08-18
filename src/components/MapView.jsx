import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Google Hybrid (uydu + etiketler) harita katmanı. lyrs=y => hybrid.
const GOOGLE_HYBRID = 'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';

// Sondaj makinesi ikonlu iğne işaretçisi (divIcon ile): beyaz daire içinde
// makine görseli, altında konumu gösteren uç. Uç tam koordinatın üstüne
// gelsin diye iconAnchor işaretçinin alt orta noktasıdır. Çerçeve rengi
// veri akışını taşır: akış varsa yeşil, durmuşsa kırmızı.
const makeIcon = (stale) =>
  L.divIcon({
    className: `mta-marker ${stale ? 'is-stale' : 'is-live'}`,
    html: [
      '<span class="mta-marker-pulse"></span>',
      '<span class="mta-marker-tail"></span>',
      '<span class="mta-marker-pin">',
      '<img class="mta-marker-img" src="/drill-icon-latest.png" alt="" />',
      '</span>',
    ].join(''),
    iconSize: [64, 78],
    iconAnchor: [32, 78],
  });

export default function MapView({ lat, lon, stale = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  // Haritayı bir kez oluştur
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = L.map(containerRef.current, {
      center: [lat, lon],
      zoom: 16,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer(GOOGLE_HYBRID, {
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      maxZoom: 21,
      attribution: '© Google',
    }).addTo(map);

    markerRef.current = L.marker([lat, lon], { icon: makeIcon(stale) }).addTo(map);
    mapRef.current = map;

    // Konteyner boyutu yerleşince haritayı düzelt
    setTimeout(() => map.invalidateSize(), 150);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Veri akışı durup başlayınca işaretçinin çerçeve rengi değişir.
  useEffect(() => {
    markerRef.current?.setIcon(makeIcon(stale));
  }, [stale]);

  // Koordinat değişince işaretçiyi güncelle; haritayı yalnızca işaretçi
  // görünümün kenarına yaklaşınca yeniden ortala (sabit makinede titremeyi önler).
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    const pos = L.latLng(lat, lon);
    marker.setLatLng(pos);
    if (!map.getBounds().pad(-0.25).contains(pos)) {
      map.panTo(pos, { animate: true, duration: 0.6 });
    }
  }, [lat, lon]);

  return <div ref={containerRef} className="map-frame" />;
}
