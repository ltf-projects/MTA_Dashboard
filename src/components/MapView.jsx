import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Google Hybrid (uydu + etiketler) harita katmanı. lyrs=y => hybrid.
const GOOGLE_HYBRID = 'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';

// Modern, nabız atan konum işaretçisi (divIcon ile).
const markerIcon = L.divIcon({
  className: 'mta-marker',
  html: '<span class="mta-marker-pulse"></span><span class="mta-marker-dot"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export default function MapView({ lat, lon }) {
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

    markerRef.current = L.marker([lat, lon], { icon: markerIcon }).addTo(map);
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
