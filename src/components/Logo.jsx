import { useState } from 'react';

// Kurumun gerçek amblemini `public/logo.png` olarak kaydederseniz otomatik
// kullanılır. Dosya yoksa aşağıdaki SVG amblem gösterilir.
export default function Logo() {
  const [imgOk, setImgOk] = useState(true);

  return (
    <div className="brand-logo">
      {imgOk ? (
        <img
          src="/logo.png"
          alt="Maden Tetkik ve Arama Genel Müdürlüğü"
          className="logo-img"
          onError={() => setImgOk(false)}
        />
      ) : (
        <MtaSeal />
      )}

      <div className="logo-text">
        <span className="logo-mta">MTA</span>
        <span className="logo-sub">MADEN TETKİK VE ARAMA</span>
      </div>
    </div>
  );
}

// MTA amblemi: dış kırmızı halkada kurum adı, iç altın disk üzerinde çapraz
// çekiçler ve "MTA" monogramı.
function MtaSeal() {
  return (
    <svg
      className="logo-seal"
      viewBox="0 0 200 200"
      role="img"
      aria-label="Maden Tetkik ve Arama Genel Müdürlüğü"
    >
      <defs>
        {/* Üst yay: soldan sağa, çemberin üstünden geçer */}
        <path id="mtaArcTop" d="M 17,100 A 83,83 0 0 1 183,100" fill="none" />
        {/* Alt yay: soldan sağa, çemberin altından geçer (yazı ters dönmez) */}
        <path id="mtaArcBottom" d="M 26,100 A 74,74 0 0 0 174,100" fill="none" />
      </defs>

      {/* Kırmızı dış disk + altın çerçeve çizgileri */}
      <circle cx="100" cy="100" r="99" fill="#d8232a" />
      <circle cx="100" cy="100" r="96" fill="none" stroke="#f6c324" strokeWidth="2.5" />
      <circle cx="100" cy="100" r="76" fill="none" stroke="#f6c324" strokeWidth="2.5" />

      {/* Altın iç disk */}
      <circle cx="100" cy="100" r="71" fill="#f7c52b" />

      {/* Halka yazıları */}
      <text className="seal-ring-text">
        <textPath href="#mtaArcTop" startOffset="50%" textAnchor="middle">
          MADEN TETKİK ve ARAMA
        </textPath>
      </text>
      <text className="seal-ring-text">
        <textPath href="#mtaArcBottom" startOffset="50%" textAnchor="middle">
          GENEL MÜDÜRLÜĞÜ
        </textPath>
      </text>

      {/* Çapraz çekiçler */}
      <g fill="#e9a81c">
        <g transform="rotate(-34 100 100)">
          <rect x="96" y="74" width="8" height="62" rx="4" />
          <rect x="83" y="58" width="34" height="17" rx="5" />
        </g>
        <g transform="rotate(34 100 100)">
          <rect x="96" y="74" width="8" height="62" rx="4" />
          <rect x="83" y="58" width="34" height="17" rx="5" />
        </g>
      </g>

      {/* Monogram ve kuruluş bilgisi */}
      <text x="100" y="118" textAnchor="middle" className="seal-monogram">
        MTA
      </text>
      <text x="100" y="134" textAnchor="middle" className="seal-year">
        1935
      </text>
      <text x="100" y="147" textAnchor="middle" className="seal-city">
        ANKARA
      </text>
    </svg>
  );
}
