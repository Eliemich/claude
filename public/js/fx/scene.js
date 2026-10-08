/**
 * Scène 3D de fond (Three.js) :
 *  - grille au sol en perspective qui défile vers l'horizon ;
 *  - graphique en bougies géant sur l'horizon (2 rangées, profondeur) ;
 *  - courbe de prix lumineuse parcourue par une comète ;
 *  - poussière de données qui monte doucement ; lueur d'horizon.
 * La caméra suit doucement la souris. Pause quand l'onglet est caché ; image fixe si
 * « réduire les animations » est activé ; rien ne casse si WebGL est indisponible.
 *   const fx = createScene(canvas, { mode: 'login' | 'app' })
 *   fx.warp()    accélération « hyperespace » (après la connexion)
 *   fx.pulse()   onde lumineuse sur la grille et les bougies (après un envoi)
 */
import * as THREE from '/vendor/three/three.module.js';
import gsap from '/vendor/gsap/index.js';

/** Hasard reproductible (même paysage à chaque visite). */
function seeded(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cours fictif (marche aléatoire avec tendance haussière) → bougies { open, close, high, low }. */
function series(n, rand, drift = 0.06) {
  const out = [];
  let price = 3;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = Math.max(0.6, open + (rand() - 0.47) * 1.25 + drift * Math.sin(i / 7));
    out.push({ open, close, high: Math.max(open, close) + rand() * 0.7, low: Math.max(0.15, Math.min(open, close) - rand() * 0.7) });
    price = close;
  }
  return out;
}

const NOOP = { warp() {}, pulse() {}, destroy() {} };

export function createScene(canvas, { mode = 'app' } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    document.documentElement.classList.add('no-webgl');
    return NOOP;
  }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = innerWidth < 760;
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 1.75));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const login = mode === 'login';
  const camera = new THREE.PerspectiveCamera(login ? 58 : 52, 1, 0.1, 260);
  const base = login ? { y: 2.4, z: 12 } : { y: 3.8, z: 13 };
  camera.position.set(0, base.y, base.z);
  const look = new THREE.Vector3(0, login ? 3 : 2.4, -34);
  camera.lookAt(look);

  const state = { speed: 1, offset: 0, pulse: 0, time: 0 };
  const shared = { uTime: { value: 0 }, uPulse: { value: 0 } };

  /* ---------- Grille au sol ---------- */
  const gridUniforms = { ...shared, uOffset: { value: 0 }, uCam: { value: camera.position }, uColor: { value: new THREE.Color(0x2f7bff) } };
  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260, 1, 1),
    new THREE.ShaderMaterial({
      uniforms: gridUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform float uOffset; uniform float uPulse; uniform vec3 uColor; uniform vec3 uCam;
        varying vec3 vWorld;
        float grid(vec2 p, float s, float w) {
          vec2 q = p / s;
          vec2 g = abs(fract(q - 0.5) - 0.5) / (fwidth(q) * w);
          return 1.0 - min(min(g.x, g.y), 1.0);
        }
        void main() {
          vec2 p = vWorld.xz + vec2(0.0, uOffset);
          float minor = grid(p, 1.5, 1.0) * 0.32;
          float major = grid(p, 7.5, 1.5);
          float d = distance(vWorld.xz, uCam.xz);
          float fade = exp(-d * 0.042) * smoothstep(1.5, 7.0, d);
          float ring = uPulse * smoothstep(4.0, 0.0, abs(d - (1.0 - uPulse) * 70.0));
          float a = (minor + major * 0.9) * fade + ring * 0.55 * exp(-d * 0.02);
          vec3 col = mix(uColor, vec3(0.62, 0.85, 1.0), clamp(major * 0.45 + ring, 0.0, 1.0));
          gl_FragColor = vec4(col * a, a);
        }`,
    }),
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.z = -70;
  scene.add(grid);

  /* ---------- Lueur d'horizon ---------- */
  const horizon = new THREE.Mesh(
    new THREE.PlaneGeometry(320, 90),
    new THREE.ShaderMaterial({
      uniforms: shared, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform float uPulse; varying vec2 vUv;
        void main() {
          vec2 c = vUv - vec2(0.5, 0.12);
          float g = exp(-length(c * vec2(1.25, 3.6)) * 3.2);
          vec3 col = mix(vec3(0.09, 0.28, 0.84), vec3(0.45, 0.72, 1.0), g * g);
          float a = g * (0.55 + uPulse * 0.5);
          gl_FragColor = vec4(col * a, a);
        }`,
    }),
  );
  horizon.position.set(0, 10, -120);
  scene.add(horizon);

  /* ---------- Bougies : graphique de l'horizon + deux allées qui s'enfoncent dans la profondeur ---------- */
  const rand = seeded(20260907);
  const items = []; // { x, z, w, c: { open, close, high, low }, scale, dim }
  const chart = series(64, rand);
  const closes = [];
  chart.forEach((c, i) => {
    const x = -((64 - 1) * 1.5) / 2 + i * 1.5;
    items.push({ x, z: -34, w: 0.84, c, scale: 1.7, dim: 1 });
    closes.push(new THREE.Vector3(x, c.close * 1.7 + 0.05, -33));
  });
  series(54, rand).forEach((c, i) => items.push({ x: -((54 - 1) * 2.4) / 2 + i * 2.4, z: -66, w: 1.3, c, scale: 2.8, dim: 0.42 }));
  for (const side of [-1, 1]) {
    series(26, rand, 0.12).forEach((c, i) => items.push({ x: side * (10 + rand() * 3 + i * 0.12), z: 4 - i * 3.4, w: 1.15, c, scale: 1.45, dim: 0.9 }));
  }
  const count = items.length;
  const candleMat = new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vColor; varying float vY; varying float vDist;
      void main() {
        vec3 p = position;
        float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z;
        p.y *= 1.0 + 0.07 * sin(uTime * 0.9 + phase);
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vec4 mv = viewMatrix * w;
        vColor = instanceColor; vY = position.y + 0.5; vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uPulse;
      varying vec3 vColor; varying float vY; varying float vDist;
      void main() {
        vec3 c = vColor * (0.28 + 0.95 * vY * vY) + vColor * uPulse * 0.9;
        c += vec3(0.55, 0.8, 1.0) * smoothstep(0.965, 1.0, vY) * 0.7;
        float fog = 1.0 - exp(-vDist * vDist * 0.00042);
        gl_FragColor = vec4(mix(c, vec3(0.01, 0.02, 0.05), fog), 1.0);
      }`,
  });
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), candleMat, count);
  const wicks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), candleMat, count);
  const m = new THREE.Matrix4();
  const up = new THREE.Color(0x3a8bff);
  const down = new THREE.Color(0x0f2f8a);
  items.forEach(({ x, z, w, c, scale, dim }, k) => {
    const lo = Math.min(c.open, c.close) * scale;
    const hi = Math.max(Math.max(c.open, c.close) * scale, lo + 0.12);
    const color = (c.close >= c.open ? up : down).clone().multiplyScalar(dim);
    m.makeScale(w, hi - lo, w).setPosition(x, (lo + hi) / 2, z);
    bodies.setMatrixAt(k, m);
    bodies.setColorAt(k, color);
    m.makeScale(0.05 * scale, (c.high - c.low) * scale, 0.05 * scale).setPosition(x, ((c.high + c.low) / 2) * scale, z);
    wicks.setMatrixAt(k, m);
    wicks.setColorAt(k, color.clone().multiplyScalar(0.8));
  });
  scene.add(bodies, wicks);

  /* ---------- Courbe de prix + comète ---------- */
  const curve = new THREE.CatmullRomCurve3(closes);
  const lineUniforms = { ...shared, uHead: { value: 0 } };
  const line = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 480, 0.05, 6, false),
    new THREE.ShaderMaterial({
      uniforms: lineUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform float uHead; uniform float uPulse; varying vec2 vUv;
        void main() {
          float d = vUv.x - uHead;
          float trail = d < 0.0 ? exp(d * 9.0) : exp(-d * 160.0);
          float a = 0.22 + trail * 1.5 + uPulse * 0.7;
          vec3 col = mix(vec3(0.16, 0.45, 1.0), vec3(0.8, 0.93, 1.0), clamp(trail, 0.0, 1.0));
          gl_FragColor = vec4(col * a, a);
        }`,
    }),
  );
  scene.add(line);

  // Halo de la comète (texture dessinée à la volée)
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(220,240,255,1)'); r.addColorStop(0.18, 'rgba(120,190,255,.75)');
    r.addColorStop(0.5, 'rgba(47,123,255,.18)'); r.addColorStop(1, 'rgba(47,123,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const comet = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  comet.scale.setScalar(4.2);
  scene.add(comet);

  /* ---------- Poussière de données ---------- */
  const N = small ? 650 : 1500;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rand() - 0.5) * 90;
    pos[i * 3 + 1] = rand() * 18;
    pos[i * 3 + 2] = -80 + rand() * 92;
    seed[i] = rand();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
    uniforms: { ...shared, uScale: { value: renderer.getPixelRatio() } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uScale; attribute float aSeed; varying float vA;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + uTime * (0.15 + aSeed * 0.45), 18.0);
        p.x += sin(uTime * 0.3 + aSeed * 30.0) * 0.4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (1.2 + aSeed * 2.6) * uScale * (26.0 / -mv.z);
        vA = (0.35 + 0.65 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 50.0) * 0.5 + 0.5) * smoothstep(90.0, 10.0, -mv.z) * smoothstep(0.0, 2.0, p.y);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uPulse; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA * (0.55 + uPulse);
        gl_FragColor = vec4(vec3(0.55, 0.78, 1.0) * a, a);
      }`,
  }));
  scene.add(dust);

  /* ---------- Souris : profondeur ---------- */
  const mouse = { x: 0, y: 0 };
  const onMove = (e) => { mouse.x = (e.clientX / innerWidth) * 2 - 1; mouse.y = (e.clientY / innerHeight) * 2 - 1; };
  addEventListener('pointermove', onMove, { passive: true });

  /* ---------- Taille ---------- */
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    // Écran étroit (téléphone) : on recule un peu pour garder le graphique dans le cadre
    camera.fov = (login ? 58 : 52) + (camera.aspect < 0.8 ? 14 : 0);
    camera.updateProjectionMatrix();
    if (reduce) render(0);
  }
  addEventListener('resize', resize);

  /* ---------- Animation ---------- */
  const clock = new THREE.Clock();
  function render(dt) {
    state.time += dt;
    state.offset = (state.offset + dt * 2.2 * state.speed) % 7.5;
    shared.uTime.value = state.time;
    shared.uPulse.value = state.pulse;
    gridUniforms.uOffset.value = -state.offset;
    const head = (state.time * 0.055) % 1;
    lineUniforms.uHead.value = head;
    comet.position.copy(curve.getPointAt(head));
    comet.material.opacity = 0.75 + state.pulse * 0.25;

    camera.position.x += (mouse.x * 1.8 - camera.position.x) * 0.035;
    camera.position.y += (base.y - mouse.y * 0.7 - camera.position.y) * 0.035;
    camera.lookAt(look);
    renderer.render(scene, camera);
  }
  const tick = () => render(Math.min(clock.getDelta(), 0.05));

  resize();
  if (reduce) render(0);
  else renderer.setAnimationLoop(tick);
  const onVisibility = () => {
    if (reduce) return;
    if (document.hidden) renderer.setAnimationLoop(null);
    else { clock.getDelta(); renderer.setAnimationLoop(tick); }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    /** Accélération vers l'horizon (transition après la connexion). */
    warp(duration = 1.1) {
      if (reduce) return Promise.resolve();
      return new Promise((done) => {
        gsap.timeline({ onComplete: done })
          .to(state, { speed: 34, duration, ease: 'power3.in' }, 0)
          .to(camera, { fov: camera.fov + 26, duration, ease: 'power3.in', onUpdate: () => camera.updateProjectionMatrix() }, 0)
          .to(base, { y: base.y - 1.2, duration, ease: 'power2.in' }, 0)
          .to(state, { pulse: 0.8, duration: duration * 0.8, ease: 'power2.in' }, 0.2);
      });
    },
    /** Onde lumineuse (après un envoi réussi). */
    pulse() {
      if (reduce) return;
      gsap.fromTo(state, { pulse: 1 }, { pulse: 0, duration: 2.2, ease: 'power2.out', overwrite: true });
      gsap.fromTo(state, { speed: 6 }, { speed: 1, duration: 2.4, ease: 'power3.out' });
    },
    destroy() {
      renderer.setAnimationLoop(null);
      removeEventListener('pointermove', onMove);
      removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      renderer.dispose();
    },
  };
}
