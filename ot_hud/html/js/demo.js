// Browser preview only (not used in game). Open html/index.html in a browser.
// Keys: 1 = on foot, 2 = car, 3 = heli / plane, W = toggle weapon, F = fire, R = reload, X = set waypoint
(() => {
    if (HUD.inGame) return;

    document.body.style.background = 'radial-gradient(120% 80% at 50% 100%, #1b2433, #07090d)';

    HUD.applyConfig({
        ui: { scale: 0.85 },
        layout: {
            compass: { top: '2.5%', scale: 0.85 }, player: { left: '3%', bottom: '6%', leftWithMinimap: '17.5%' },
            right: { right: '3%', bottom: '6%' }, aircraft: { bottom: '5%' },
        },
        colors: {
            primary: '#3b82f6', primaryLight: '#60a5fa', primaryDark: '#1d4ed8', primaryPale: '#93c5fd',
            danger: '#ef4444', warning: '#facc15', success: '#4ade80', text: '#ffffff', muted: '#7d869a',
            mutedLight: '#8fa3c4', voice: '#60a5fa', radio: '#4ade80', hunger: '#facc15', thirst: '#22d3ee',
            stress: '#f472b6', stamina: '#a3e635', oxygen: '#38bdf8', durability: '#22d3ee',
        },
        labels: {
            directions: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], setWaypoint: 'Set waypoint',
            removeWaypoint: 'Remove waypoint', waypoint: 'Waypoint', reloading: 'RELOADING', durability: 'DUR',
            kmh: 'KM/H', mph: 'MPH', airspeed: 'AIRSPEED', altitude: 'ALTITUDE', knots: 'KTS', feet: 'FT', fpm: 'FPM',
            throttle: 'THR', fuel: 'FUEL', engine: 'ENG', gearUp: 'GEAR UP', gearDown: 'GEAR DOWN',
            gearMoving: 'GEAR ...', rotor: 'ROTOR',
        },
        player: { stats: ['voice', 'hunger', 'thirst', 'stress'], lowThreshold: 20, stressDanger: 80 },
        weapon: { maxSegments: 30, lowAmmo: 0.25 },
        vehicle: { unit: 'kmh', redline: 0.85, lowFuel: 20, beltWarningSpeed: 20 },
        aircraft: { invertRoll: false, pitchScale: 1.5, lowFuel: 20 },
        compass: { key: 'X' },
    });
    HUD.onMessage({ action: 'visible', state: true });

    const st = { mode: 'foot', weapon: true, mag: 9, total: 237, reloading: false, wp: null, t: 0, belt: false };
    const params = new URLSearchParams(location.search);
    if (params.get('mode')) st.mode = params.get('mode');

    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:12px;top:12px;display:flex;gap:6px;z-index:10;font:700 12px Satoshi,sans-serif';
    document.body.appendChild(bar);
    const btn = (label, fn) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'height:30px;padding:0 12px;border-radius:6px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#cbd5e1;cursor:pointer;font:inherit';
        b.onclick = fn;
        bar.appendChild(b);
    };
    btn('On foot [1]', () => { st.mode = 'foot'; });
    btn('Car [2]', () => { st.mode = 'car'; });
    btn('Heli / Plane [3]', () => { st.mode = 'air'; });
    btn('Weapon [W]', () => { st.weapon = !st.weapon; });
    btn('Fire [F]', () => fire());
    btn('Reload [R]', () => reload());

    const fire = () => { if (!st.reloading && st.mag > 0) st.mag--; };
    const reload = () => {
        if (st.reloading || !st.total) return;
        st.reloading = true;
        setTimeout(() => { const take = Math.min(12 - st.mag, st.total); st.mag += take; st.total -= take; st.reloading = false; }, 1200);
    };

    const POINTS = [
        { id: 'garage', label: 'Garage', sprite: 357, color: '#5db6e5', bearing: 214 },
        { id: 'gas', label: 'Gas Station', sprite: 361, color: '#e03232', bearing: 152, dist: 420 },
        { id: 'home', label: 'Home', sprite: 40, bearing: 172, dist: 860 },
        { id: 'bank', label: 'Bank', sprite: 108, bearing: 245, dist: 1200 },
        { id: 'hospital', label: 'Hospital', sprite: 61, color: '#e03232', bearing: 160, dist: 90 },
    ];
    let aimed = null;

    window.addEventListener('keydown', e => {
        const k = e.key.toLowerCase();
        if (k === '1') st.mode = 'foot';
        if (k === '2') st.mode = 'car';
        if (k === '3') st.mode = 'air';
        if (k === 'w') st.weapon = !st.weapon;
        if (k === 'f') fire();
        if (k === 'r') reload();
        if (k === 'b') st.belt = !st.belt;
        if (k === 'x' && aimed) st.wp = st.wp === aimed.id ? null : aimed.id;
    });

    const norm = d => ((d % 360) + 540) % 360 - 180;

    setInterval(() => {
        const t = ++st.t;
        const heading = ((200 + Math.sin(t / 140) * 55) % 360 + 360) % 360;
        const pts = POINTS.map(p => ({ ...p, dist: p.dist || Math.round(12 + Math.abs(Math.sin(t / 70)) * 150), active: p.id === st.wp }));
        aimed = pts.filter(p => p.dist <= 150 && Math.abs(norm(p.bearing - heading)) <= 5).sort((a, b) => Math.abs(norm(a.bearing - heading)) - Math.abs(norm(b.bearing - heading)))[0] || null;
        pts.forEach(p => { p.aimed = aimed && aimed.id === p.id; });
        const wp = pts.find(p => p.active);

        HUD.onMessage({
            action: 'compass', heading, street: heading < 200 ? 'Los Santos Freeway' : 'Power St',
            points: pts, waypoint: wp ? { label: wp.label, dist: wp.dist } : null,
            prompt: aimed ? { label: aimed.label, dist: aimed.dist, sprite: aimed.sprite, color: aimed.color, active: aimed.active } : null,
        });

        const cyc = (t % 220) / 220;
        const gearN = Math.min(6, 1 + Math.floor(cyc * 6));
        const speed = Math.round(cyc * 140);
        const alt = Math.round(1240 + Math.sin(t / 30) * 60);

        HUD.onMessage({
            action: 'update',
            minimap: false,
            player: {
                health: 56, armor: 75, hunger: 50, thirst: 92, stress: 12,
                voice: { value: 67, talking: (t % 60) < 25, radio: false, radioTalking: false },
            },
            weapon: st.weapon && st.mode !== 'air' ? {
                kind: 'gun', type: 'PISTOL', name: 'Pistol MK2', mag: st.mag, total: st.total, cap: 12,
                reloading: st.reloading, durability: 82,
            } : null,
            vehicle: st.mode === 'car' ? {
                speed, rpm: Math.min(1, 0.25 + ((cyc * 6) % 1) * 0.75), gear: speed === 0 ? 'N' : String(gearN),
                engine: 92, body: 78, fuel: 64, electric: false, lights: 'low', cruise: false,
                belt: st.belt, hasBelt: true, locked: false,
            } : null,
            aircraft: st.mode === 'air' ? {
                heli: false, speed: Math.round(182 + Math.sin(t / 20) * 6), alt, vs: Math.round(Math.cos(t / 30) * 400),
                roll: Math.sin(t / 35) * 14, pitch: Math.sin(t / 50) * 5,
                throttle: Math.round(70 + Math.sin(t / 25) * 15), fuel: 68, engine: 90, gear: 'up',
            } : null,
        });
    }, 60);
})();
