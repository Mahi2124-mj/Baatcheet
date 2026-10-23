'use client';
// The start screen: a phone launch advertisement for a made-up brand ("Orbit 7 Pro"). It is an ordinary
// looking product page; a tap anywhere on the big phone in the first screen opens the app.

const COLORS = [
  { name: 'Copper Dawn', body: ['#c98a5e', '#7b4a2d'] },
  { name: 'Glacier', body: ['#c9d6df', '#7c8c99'] },
  { name: 'Graphite', body: ['#5b5d63', '#26272b'] },
  { name: 'Sand', body: ['#e2d3bd', '#a8957a'] },
] as const;

const SPECS = [
  ['Display', '6.7″ LTPO OLED, 1–120 Hz, 3000 nits peak'],
  ['Chip', 'O7 Pro, 3 nm, 8-core CPU, 10-core GPU'],
  ['Cameras', '200 MP main · 50 MP ultra-wide · 50 MP 5× periscope'],
  ['Video', '8K at 60 fps, 4K Dolby Vision at 120 fps'],
  ['Battery', '5,100 mAh, 80 W wired, 50 W wireless'],
  ['Build', 'Titanium frame, ceramic glass, IP68'],
] as const;

export function LaunchAd({ onOpen }: { onOpen: () => void }) {
  const toTop = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="min-h-dvh bg-black font-sans text-[#f5f5f7] antialiased" style={{ colorScheme: 'dark' }}>
      <header className="safe-t sticky top-0 z-20 border-b border-white/10 bg-black/70 backdrop-blur-xl">
        <nav className="mx-auto flex h-12 max-w-5xl items-center justify-between px-5 text-[13px]">
          <span className="flex items-center gap-1.5 text-[17px] font-semibold tracking-tight">
            <svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden>
              <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
              <circle cx="15.3" cy="4.7" r="2.2" fill="#e09a6a" />
            </svg>
            orbit
          </span>
          <span className="flex items-center gap-5 text-white/70">
            <button onClick={toTop('camera')} className="hidden hover:text-white sm:inline">Camera</button>
            <button onClick={toTop('colours')} className="hidden hover:text-white sm:inline">Colours</button>
            <button onClick={toTop('specs')} className="hidden hover:text-white sm:inline">Tech specs</button>
            <button onClick={toTop('colours')} className="rounded-full bg-[#e09a6a] px-3.5 py-1 font-medium text-black">Buy</button>
          </span>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden px-5 pb-10 pt-12 text-center sm:pt-16">
          <div className="pointer-events-none absolute inset-x-0 top-40 mx-auto h-[420px] max-w-[520px] rounded-full bg-[#e09a6a]/25 blur-[90px]" aria-hidden />
          <p className="relative text-[17px] font-semibold text-[#e09a6a]">New</p>
          <h1 className="relative mt-1 text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[72px]">Orbit 7 Pro</h1>
          <p className="relative mx-auto mt-3 max-w-md text-[21px] leading-snug text-white/80 sm:text-[26px]">Light, caught in a ring.</p>
          <div className="relative mt-6 flex items-center justify-center gap-4 text-[15px]">
            <button onClick={toTop('colours')} className="rounded-full bg-[#e09a6a] px-5 py-2 font-medium text-black">Buy</button>
            <button onClick={toTop('camera')} className="text-[#e09a6a] hover:underline">See the camera</button>
          </div>
          <p className="relative mt-3 text-[13px] text-white/50">From ₹1,19,900 or ₹9,992/mo. for 12 mo.*</p>

          {/* Tapping the phone opens the app straight away. */}
          <div
            className="relative mx-auto mt-10 w-[230px] select-none sm:w-[270px]"
            style={{ WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' }}
            onClick={onOpen}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Phone body={COLORS[0].body} />
          </div>
        </section>

        {/* Camera */}
        <section id="camera" className="scroll-mt-14 px-5 py-16">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-[34px] font-semibold leading-tight tracking-[-0.02em] sm:text-[48px]">The Halo camera system.</h2>
            <p className="mt-4 max-w-xl text-[19px] leading-relaxed text-white/70">
              Three cameras sit inside one ring of sapphire glass. A larger main sensor pulls detail out of the dark, and the periscope gets you close from across the room — without the grain.
            </p>
            <dl className="mt-10 grid grid-cols-3 gap-4 border-t border-white/10 pt-8">
              {[
                ['200MP', 'Main camera'],
                ['5×', 'Optical zoom'],
                ['8K', 'Video at 60 fps'],
              ].map(([big, small]) => (
                <div key={small}>
                  <dt className="text-[32px] font-semibold tracking-tight text-[#e09a6a] sm:text-[44px]">{big}</dt>
                  <dd className="mt-1 text-[14px] text-white/60">{small}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Night photo look-alike */}
        <section className="px-5 pb-16">
          <div className="mx-auto max-w-3xl overflow-hidden rounded-[28px]">
            <NightShot />
          </div>
          <p className="mx-auto mt-4 max-w-3xl text-[14px] text-white/50">Shot on Orbit 7 Pro in Night mode, 1/3 s handheld.</p>
        </section>

        {/* Colours */}
        <section id="colours" className="scroll-mt-14 bg-[#0c0c0d] px-5 py-16">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-[34px] font-semibold leading-tight tracking-[-0.02em] sm:text-[48px]">Four finishes. Brushed titanium.</h2>
            <div className="mt-10 grid grid-cols-4 gap-3 sm:gap-6">
              {COLORS.map((c) => (
                <div key={c.name} className="text-center">
                  <div className="mx-auto w-full max-w-[110px]">
                    <Phone body={c.body} small />
                  </div>
                  <p className="mt-3 text-[13px] text-white/70">{c.name}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Specs */}
        <section id="specs" className="scroll-mt-14 px-5 py-16">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-[28px] font-semibold tracking-[-0.02em] sm:text-[40px]">Tech specs</h2>
            <dl className="mt-8 divide-y divide-white/10 border-y border-white/10">
              {SPECS.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[110px_1fr] gap-4 py-4 text-[15px] sm:grid-cols-[180px_1fr]">
                  <dt className="text-white/50">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <footer className="safe-b border-t border-white/10 px-5 py-8 text-[12px] leading-relaxed text-white/40">
        <div className="mx-auto max-w-3xl space-y-2">
          <p>* Price includes GST. Monthly price with no-cost EMI on select cards; terms apply. Battery life and charging times vary with use and settings.</p>
          <p>Copyright © 2026 Orbit Devices. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

/** Back of the phone: rounded titanium slab with a round camera ring near the top. */
function Phone({ body, small }: { body: readonly [string, string]; small?: boolean }) {
  const id = `ph-${body[0].slice(1)}${small ? 's' : ''}`;
  return (
    <svg viewBox="0 0 300 620" className="block w-full drop-shadow-[0_30px_40px_rgba(0,0,0,0.6)]" aria-label="Orbit 7 Pro, back" role="img">
      <defs>
        <linearGradient id={`${id}-b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={body[0]} />
          <stop offset="1" stopColor={body[1]} />
        </linearGradient>
        <linearGradient id={`${id}-e`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id={`${id}-l`} cx="0.35" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#3b4a6b" />
          <stop offset="0.45" stopColor="#0b0f1a" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <radialGradient id={`${id}-r`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.82" stopColor="#141416" />
          <stop offset="1" stopColor="#2c2c30" />
        </radialGradient>
      </defs>
      <rect x="4" y="4" width="292" height="612" rx="52" fill={`url(#${id}-b)`} />
      <rect x="4" y="4" width="292" height="612" rx="52" fill="none" stroke={`url(#${id}-e)`} strokeWidth="4" />
      {/* Camera ring */}
      <circle cx="150" cy="135" r="93" fill="#000" opacity="0.18" />
      <circle cx="150" cy="132" r="90" fill={`url(#${id}-r)`} stroke="#ffffff" strokeOpacity="0.18" strokeWidth="2" />
      <circle cx="150" cy="132" r="80" fill="none" stroke="#ffffff" strokeOpacity="0.06" strokeWidth="1" />
      {/* Main lens */}
      <circle cx="150" cy="118" r="34" fill="#1d1d21" stroke="#3a3a40" strokeWidth="3" />
      <circle cx="150" cy="118" r="25" fill={`url(#${id}-l)`} />
      <circle cx="142" cy="110" r="5" fill="#fff" opacity="0.18" />
      {/* Ultra-wide and periscope */}
      <circle cx="104" cy="162" r="20" fill="#1d1d21" stroke="#3a3a40" strokeWidth="2.5" />
      <circle cx="104" cy="162" r="14" fill={`url(#${id}-l)`} />
      <rect x="176" y="146" width="36" height="32" rx="8" fill="#1d1d21" stroke="#3a3a40" strokeWidth="2.5" />
      <rect x="183" y="152" width="22" height="20" rx="4" fill={`url(#${id}-l)`} />
      {/* Flash */}
      <circle cx="150" cy="186" r="6" fill="#f3ead7" opacity="0.9" />
      {/* Wordmark */}
      {!small && (
        <text x="150" y="520" textAnchor="middle" fontSize="20" fontWeight="600" fill="#fff" fillOpacity="0.35" letterSpacing="2" fontFamily="-apple-system, system-ui, sans-serif">
          orbit
        </text>
      )}
    </svg>
  );
}

/** A night city photo look-alike for the camera section. */
function NightShot() {
  return (
    <svg viewBox="0 0 800 450" className="block w-full" aria-label="Night photo of a city skyline by the water" role="img">
      <defs>
        <linearGradient id="ns-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#060a1f" />
          <stop offset="0.7" stopColor="#1d1f4a" />
          <stop offset="1" stopColor="#5a3550" />
        </linearGradient>
        <linearGradient id="ns-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2540" />
          <stop offset="1" stopColor="#05060f" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#ns-sky)" />
      {Array.from({ length: 40 }).map((_, i) => (
        <circle key={i} cx={(i * 197) % 800} cy={(i * 53) % 160} r={i % 5 === 0 ? 1.4 : 0.8} fill="#fff" opacity={0.3 + ((i * 7) % 5) / 10} />
      ))}
      <circle cx="640" cy="80" r="22" fill="#f4ecd8" opacity="0.9" />
      {[
        [0, 210, 60], [60, 170, 40], [100, 230, 70], [170, 140, 50], [220, 190, 45], [265, 110, 55], [320, 175, 60],
        [380, 150, 40], [420, 200, 65], [485, 125, 50], [535, 185, 55], [590, 160, 45], [635, 205, 60], [695, 145, 50], [745, 190, 55],
      ].map(([x, y, w], i) => (
        <g key={i}>
          <rect x={x} y={y} width={w} height={300 - y} fill={i % 2 ? '#0d1024' : '#121633'} />
          {Array.from({ length: Math.floor((300 - y) / 18) }).map((_, r) =>
            Array.from({ length: Math.floor(w / 14) }).map((__, c) =>
              (r * 3 + c + i) % 4 === 0 ? <rect key={`${r}-${c}`} x={x + 5 + c * 14} y={y + 8 + r * 18} width="5" height="7" fill="#ffd38a" opacity="0.8" /> : null,
            ),
          )}
        </g>
      ))}
      <rect y="300" width="800" height="150" fill="url(#ns-water)" />
      {Array.from({ length: 26 }).map((_, i) => (
        <rect key={i} x={(i * 131) % 780} y={310 + ((i * 29) % 120)} width={20 + ((i * 17) % 50)} height="2" fill="#ffd38a" opacity={0.15 + ((i * 3) % 5) / 20} />
      ))}
    </svg>
  );
}
