/**
 * scene.ts — dunia 3D Three.js untuk ULTIMATE ROULETTE.
 * Interior 3D (ruangan, meja, lampu) + semua objek/gameplay 2D doodle
 * (billboard sprites) = gaya 2.5D. Post-processing: bloom, grain,
 * chromatic aberration, vignette, flash, desaturasi.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import {
  texGunAimEnemy,
  texGunAimSelf,
  texGunOpen,
  texShell,
  texEnemy,
  texSpeech,
  texMuzzle,
  texSmoke,
  texSplat,
  texSpark,
  texRing,
  texDust,
  texWall,
  texFloor,
  texCeiling,
  texTableTop,
  texPoster,
  texArrowSign,
  texPriceTag,
  texBellNote,
  texCuffsProp,
  texCoffeeCup,
  texVoodooDoll,
  texSkillIcon,
  type SkillId,
  type EnemyMood,
} from "./doodle";

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAberration: { value: 0 },
    uVignette: { value: 0.55 },
    uFlash: { value: 0 },
    uDesat: { value: 0 },
    uRedPulse: { value: 0 },
    uGrain: { value: 0.045 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uVignette;
    uniform float uFlash;
    uniform float uDesat;
    uniform float uRedPulse;
    uniform float uGrain;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      float d = length(dir);
      float ab = uAberration * (0.004 + d * 0.02);
      float r = texture2D(tDiffuse, uv + dir * ab).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - dir * ab).b;
      vec3 col = vec3(r, g, b);
      col = mix(col, vec3(1.0, 0.97, 0.9), uFlash);
      col = mix(col, vec3(0.72, 0.06, 0.04), uRedPulse * (0.3 + 0.7 * d));
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), uDesat);
      col *= 1.0 - uVignette * smoothstep(0.3, 0.82, d);
      float n = hash(uv * (1.0 + fract(uTime) * 13.7) + fract(uTime) * 7.3);
      col += (n - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  rotVel: number;
  life: number;
  maxLife: number;
  grow: number;
  gravity: number;
  fadePow: number;
}

/** One physical shop item standing on the table. */
interface ShopItem {
  group: THREE.Group;
  glow: THREE.Mesh | null;
  hit: THREE.Mesh;
  base: THREE.Vector3;
  idx: number;
  bornAt: number;
  hoverK: number;
  hoverTarget: number;
}

function doodleMat(tex: THREE.Texture, opts: { lit?: boolean; alphaTest?: number } = {}) {
  if (opts.lit) {
    return new THREE.MeshLambertMaterial({
      map: tex,
      transparent: true,
      alphaTest: opts.alphaTest ?? 0.02,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(0x8a8378),
      emissiveMap: tex,
      emissiveIntensity: 0.55,
    });
  }
  return new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    alphaTest: opts.alphaTest ?? 0.02,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
}

function ctex(cv: HTMLCanvasElement, repeat?: [number, number]) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

export class RouletteScene {
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  composer!: EffectComposer;
  finalPass!: ShaderPass;
  bloomPass!: UnrealBloomPass;

  private camGroup = new THREE.Group();
  private camRig = new THREE.Group();
  private lookX = 0;
  private lookY = 0;
  private lookXT = 0;
  private lookYT = 0;

  private lampPivot!: THREE.Group;
  private spot!: THREE.SpotLight;
  private muzzleLight!: THREE.PointLight;
  private ambience!: THREE.HemisphereLight;

  private enemyMesh!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  private enemyBasePos = new THREE.Vector3(0, 1.42, -1.92);
  private enemyWobble = 0;
  private speechMesh!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private speechTimer = 0;

  private gunMesh!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private gunAimTex: { enemy: THREE.Texture; self: THREE.Texture; open: THREE.Texture };
  private gunAimTexEnemy2: THREE.Texture;
  private muzzleMesh!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private gunTarget = new THREE.Vector3(0, -0.5, -0.8);
  private gunCurrent = new THREE.Vector3(0, -0.9, -0.75);
  private gunPose: "enemy" | "self" | null = null;
  private gunRecoil = 0;

  private diceMesh!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private diceGhosts: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private diceFaceTex: Record<string, THREE.Texture> = {};

  private particles: Particle[] = [];
  private shellTex: { live: THREE.Texture; blank: THREE.Texture };
  private splatTexs: THREE.Texture[] = [];
  private sparkTex!: THREE.Texture;
  private smokeTex!: THREE.Texture;
  private ringTex!: THREE.Texture;
  private dustTex!: THREE.Texture;
  private muzzleTex!: THREE.Texture;

  /* physical shop */
  private shopMat!: THREE.Mesh;
  private shopBell: THREE.Group | null = null;
  private bellProps!: THREE.Group; // coaster + "RING ME" note around the bell
  private bellHit!: THREE.Mesh;
  private shopItems = new Map<SkillId, ShopItem>();
  private shopHitboxes: THREE.Mesh[] = [];
  private shopAnims: { id: SkillId; item: ShopItem; t0: number }[] = [];
  /** Props leaving the table with style (bell rings → everything flies to THE DEALER). */
  private vanishAnims: {
    obj: THREE.Object3D;
    t0: number;
    from: THREE.Vector3;
    rot: THREE.Euler;
    spin: boolean;
    disposable: boolean;
  }[] = [];
  private shopTexCache = new Map<string, THREE.Texture>();
  /** true while the shop props are mid-vanish (blocks idle animations). */
  private shopVanishing = false;

  /* spent-shell trail: every fired shell lands on the table's front edge
     so both sides can physically recount the round at any moment */
  private trailMeshes: THREE.Mesh[] = [];
  private trailSweeps: { mesh: THREE.Mesh; t0: number; from: THREE.Vector3 }[] = [];
  private raycaster = new THREE.Raycaster();
  private bellHover = false;
  private bellHoverK = 0;
  private bellRingT = 0;

  /* physical skill VFX props */
  private cuffsMesh!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private cuffsShown = false;
  private cuffsPopT = 0;
  private voodooDolls = new Map<
    "player" | "enemy",
    { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; born: number; attached: boolean }
  >();
  /* COFFEE: a real mug per side of the table — yours and THE DEALER's.
     COFFEE lifts the drinker's own mug for a genuine sip. */
  private coffeeCups!: Record<"player" | "enemy", THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>>;
  private coffeeHomes: Record<"player" | "enemy", THREE.Vector3> = {
    player: new THREE.Vector3(-0.88, 0.99, 0.26),
    enemy: new THREE.Vector3(0.72, 0.99, -0.74),
  };
  private coffeeBusy = false;
  /* CUFFS: the steel bracelet lies on the RIGHT side of the table,
     mid-depth — it is picked up for real before the interrogation. */
  private cuffProp!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private cuffPropHome = new THREE.Vector3(0.98, 1.07, -0.22);
  private cuffPropGone = false;
  private cuffPropPopT = 0;
  private dollyTarget = new THREE.Vector3(0, 0, 0);
  private gunSpinT = 0;
  private gunPeeking = false;

  private trauma = 0;
  private timeScale = 1;
  private timeScaleTarget = 1;
  private lampFlicker = 1;
  private lampBoost = 1;
  private shakeOff = new THREE.Vector2();

  onFrame: ((dt: number, t: number) => void) | null = null;

  init(container: HTMLElement) {
    const w = container.clientWidth;
    const h = container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0a08);
    this.scene.fog = new THREE.FogExp2(0x0b0a08, 0.055);

    this.camera = new THREE.PerspectiveCamera(56, w / h, 0.05, 40);
    this.camera.position.set(0, 1.42, 1.5);
    this.camGroup.add(this.camera);
    this.camRig.add(this.camGroup);
    this.scene.add(this.camRig);

    this.buildRoom();
    this.buildLights();
    this.buildTable();
    this.buildEnemy();
    this.buildGun();
    this.buildDice();
    this.buildParticles();
    this.buildShop();
    this.buildSkillProps();

    // post processing
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.5, 1.0);
    this.composer.addPass(this.bloomPass);
    this.finalPass = new ShaderPass(FinalShader);
    this.composer.addPass(this.finalPass);

    window.addEventListener("resize", this.onResize);
    // debug handle (used for inspection via agent-browser)
    (window as unknown as { __rs?: RouletteScene }).__rs = this;
  }

  private onResize = () => {
    const el = this.renderer.domElement.parentElement;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  };

  /* ---------------- build ---------------- */

  private buildRoom() {
    const floorTex = ctex(texFloor(), [2, 2]);
    // everything in the room is FULLY MATTE: real-world diffuse light only,
    // nothing bounces a highlight back into the camera. The glossy surfaces
    // are reserved for the table, the coffee mugs, the bell and the cuffs.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 11),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 1, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ceilTex = ctex(texCeiling(), [2, 2]);
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 11),
      new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1, metalness: 0 }),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 3.5;
    this.scene.add(ceil);

    const mkWall = (tex: HTMLCanvasElement, w: number, h: number) =>
      new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({ map: ctex(tex), roughness: 1, metalness: 0 }),
      );

    const back = mkWall(texWall(5, "HA HA HA"), 11, 3.5);
    back.position.set(0, 1.75, -3.6);
    back.receiveShadow = true;
    this.scene.add(back);

    const front = mkWall(texWall(9), 11, 3.5);
    front.position.set(0, 1.75, 3.8);
    front.rotation.y = Math.PI;
    this.scene.add(front);

    const left = mkWall(texWall(13, "REGRET"), 11, 3.5);
    left.position.set(-4.6, 1.75, 0);
    left.rotation.y = Math.PI / 2;
    left.receiveShadow = true;
    this.scene.add(left);

    const right = mkWall(texWall(17), 11, 3.5);
    right.position.set(4.6, 1.75, 0);
    right.rotation.y = -Math.PI / 2;
    this.scene.add(right);

    // poster di dinding belakang
    const poster = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.85),
      doodleMat(ctex(texPoster(1, "LAST CALL")), { lit: true }),
    );
    poster.position.set(-1.55, 2.1, -3.58);
    poster.rotation.z = 0.05;
    this.scene.add(poster);

    const poster2 = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.85),
      doodleMat(ctex(texPoster(2, "OUT!")), { lit: true }),
    );
    poster2.position.set(-3.2, 2.0, -3.58);
    poster2.rotation.z = -0.08;
    this.scene.add(poster2);

    // papan panah di dinding kanan
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.4),
      doodleMat(ctex(texArrowSign()), { lit: true }),
    );
    sign.position.set(4.58, 1.9, -1.2);
    sign.rotation.y = -Math.PI / 2;
    sign.rotation.z = 0.06;
    this.scene.add(sign);

    // (corner crate + boombox were removed — the room is deliberately bare:
    // only the table, its props and THE DEALER carry the scene now)
  }

  private buildLights() {
    this.ambience = new THREE.HemisphereLight(0x35281c, 0x0c0a07, 0.95);
    this.scene.add(this.ambience);

    // lampu gantung
    this.lampPivot = new THREE.Group();
    this.lampPivot.position.set(0, 3.5, -0.55);
    this.scene.add(this.lampPivot);

    const wire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.62, 6),
      new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1, metalness: 0 }),
    );
    wire.position.y = -0.31;
    this.lampPivot.add(wire);

    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.3, 24, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x233324,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );
    shade.position.y = -0.68;
    shade.castShadow = true;
    this.lampPivot.add(shade);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 16, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.7, 1.7) }),
    );
    bulb.position.y = -0.76;
    this.lampPivot.add(bulb);

    this.spot = new THREE.SpotLight(0xffdc9e, 60, 9, 0.95, 0.55, 1.6);
    this.spot.position.set(0, -0.7, 0);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.bias = -0.002;
    // target statis di meja (bukan child pivot, agar arah cahaya benar)
    const target = new THREE.Object3D();
    target.position.set(0, 0.86, -0.45);
    this.scene.add(target);
    this.lampPivot.add(this.spot);
    this.spot.target = target;

    // warm soft fill light so THE DEALER is visible
    const fill = new THREE.PointLight(0xffd9a0, 1.6, 4.5, 2);
    fill.position.set(0.25, 2.3, -1.5);
    this.scene.add(fill);

    this.muzzleLight = new THREE.PointLight(0xffc46b, 0, 6, 1.8);
    this.muzzleLight.position.set(0, 1.3, 0.6);
    this.scene.add(this.muzzleLight);
  }

  private buildTable() {
    // the tabletop is one of the few GLOSSY surfaces: the lamp reads as a
    // real specular sheen sliding across the wood (light reflects back)
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(2.7, 0.09, 1.35),
      new THREE.MeshStandardMaterial({ map: ctex(texTableTop()), roughness: 0.3, metalness: 0.06 }),
    );
    top.position.set(0, 0.86, -0.25);
    top.castShadow = true;
    top.receiveShadow = true;
    this.scene.add(top);

    // legs stay fully matte — real-world diffuse, no highlight toward the camera
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x2e2117,
      roughness: 1,
      metalness: 0,
    });
    for (const [lx, lz] of [
      [-1.2, -0.75],
      [1.2, -0.75],
      [-1.2, 0.25],
      [1.2, 0.25],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.82, 0.09), legMat);
      leg.position.set(lx, 0.41, lz - 0.0);
      leg.castShadow = true;
      this.scene.add(leg);
    }

    // (all decorative table clutter was removed — the table now only ever
    // carries what gameplay puts on it: coffee mugs, the bell, the cuffs,
    // the shop mat with its cards and the spent-shell trail)
  }

  private buildEnemy() {
    const tex = ctex(texEnemy("idle1"));
    this.enemyMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), doodleMat(tex, { lit: true }));
    this.enemyMesh.position.copy(this.enemyBasePos);
    this.scene.add(this.enemyMesh);

    this.speechMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.64),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, alphaTest: 0.02, depthWrite: false }),
    );
    this.speechMesh.position.set(0.72, 2.32, -1.7);
    this.speechMesh.renderOrder = 5;
    this.scene.add(this.speechMesh);
  }

  private buildGun() {
    const tEnemy = ctex(texGunAimEnemy());
    this.gunAimTex = {
      enemy: tEnemy,
      self: ctex(texGunAimSelf()),
      open: ctex(texGunOpen()),
    };
    this.gunAimTexEnemy2 = tEnemy;
    this.gunMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.12),
      new THREE.MeshBasicMaterial({
        map: this.gunAimTex.enemy,
        transparent: true,
        alphaTest: 0.02,
        side: THREE.DoubleSide,
      }),
    );
    this.gunMesh.position.copy(this.gunCurrent);
    this.gunMesh.visible = false;
    this.gunMesh.renderOrder = 8;
    this.camera.add(this.gunMesh);

    this.muzzleMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 0.85),
      new THREE.MeshBasicMaterial({
        map: ctex(texMuzzle()),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: new THREE.Color(2.4, 2.4, 2.4),
      }),
    );
    this.muzzleMesh.position.set(0, -0.26, -1.35);
    this.muzzleMesh.renderOrder = 9;
    this.camera.add(this.muzzleMesh);
  }

  private buildDice() {
    this.diceMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.74, 0.74),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false }),
    );
    this.diceMesh.renderOrder = 20;
    this.diceMesh.position.set(0, -0.02, -1.55);
    this.camera.add(this.diceMesh);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Mesh(
        new THREE.PlaneGeometry(0.74, 0.74),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false }),
      );
      g.renderOrder = 19 - i;
      g.position.set(0, -0.02, -1.55 - (i + 1) * 0.02);
      this.camera.add(g);
      this.diceGhosts.push(g);
    }
  }

  private buildParticles() {
    this.shellTex = {
      live: ctex(texShell("live")),
      blank: ctex(texShell("blank")),
    };
    this.splatTexs = [ctex(texSplat(111)), ctex(texSplat(222))];
    this.sparkTex = ctex(texSpark());
    this.smokeTex = ctex(texSmoke());
    this.ringTex = ctex(texRing());
    this.dustTex = ctex(texDust());
    this.muzzleTex = ctex(texMuzzle());
  }

  /* ---------------- physical skill props (real VFX) ---------------- */

  /** A glossy doodle-prop material: lit, bright even in shadow, and with a
   *  real specular glint — reserved for the four reflective props
   *  (table / coffee / bell / cuffs). */
  private glossyDoodleMat(tex: THREE.Texture, shine = 0.28): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.02,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(0x8a8378),
      emissiveMap: tex,
      emissiveIntensity: 0.62,
      roughness: shine,
      metalness: 0.35,
    });
  }

  private buildSkillProps() {
    // TWO steaming coffee mugs — one per side of the table.
    // COFFEE lifts the drinker's own mug for a real sip.
    const mkCup = (home: THREE.Vector3, tiltY: number) => {
      const cup = new THREE.Mesh(
        new THREE.PlaneGeometry(0.15, 0.19),
        this.glossyDoodleMat(ctex(texCoffeeCup()), 0.22),
      );
      cup.position.copy(home);
      cup.rotation.y = tiltY;
      cup.renderOrder = 6;
      cup.castShadow = true;
      // the mug must read bright even where the spotlight barely reaches
      cup.material.emissiveIntensity = 1.25;
      this.scene.add(cup);
      return cup;
    };
    this.coffeeCups = {
      player: mkCup(this.coffeeHomes.player, 0.14), // your side, front-left
      enemy: mkCup(this.coffeeHomes.enemy, -0.2), // THE DEALER's side, back-right
    };

    // the handcuffs lie on the table — right side, mid-depth — until
    // someone really picks them up (CUFFS) and snaps them onto wrists
    this.cuffProp = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.33),
      this.glossyDoodleMat(ctex(texCuffsProp()), 0.26),
    );
    this.cuffProp.position.copy(this.cuffPropHome);
    this.cuffProp.rotation.y = 0.3;
    this.cuffProp.renderOrder = 6;
    this.cuffProp.castShadow = true;
    this.scene.add(this.cuffProp);

    // handcuffs that snap onto THE DEALER's wrists
    this.cuffsMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.6),
      new THREE.MeshBasicMaterial({
        map: ctex(texCuffsProp()),
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
      }),
    );
    this.cuffsMesh.position.set(this.enemyBasePos.x, this.enemyBasePos.y - 0.34, this.enemyBasePos.z + 0.42);
    this.cuffsMesh.visible = false;
    this.cuffsMesh.renderOrder = 7;
    this.scene.add(this.cuffsMesh);
  }

  /** Push the camera right up into THE DEALER's face (cuffs time). */
  dollyToDealer() {
    this.dollyTarget.set(0, -0.04, -1.45);
  }

  /** Camera back to the player's seat. */
  dollyHome() {
    this.dollyTarget.set(0, 0, 0);
  }

  /** Snap the handcuffs onto the DEALER (or take them off).
   *  Off: the bracelet pops back onto its table spot with a dust puff. */
  dealerCuffed(show: boolean) {
    if (show === this.cuffsShown) {
      // still keep the table-prop state consistent on hard resets
      if (!show && this.cuffPropGone && !this.cuffProp.visible) this.cuffPropReturn(true);
      return;
    }
    this.cuffsShown = show;
    this.cuffsMesh.visible = show;
    if (show) {
      this.cuffsPopT = 1;
      const at = this.cuffsMesh.position.clone();
      this.sparkBurst(at, 10);
      this.ringBurst(at, 0.55);
      this.addTrauma(0.3);
      this.setAberration(1.4);
      setTimeout(() => this.setAberration(0), 300);
    } else if (this.cuffPropGone) {
      this.cuffPropReturn(false);
    }
  }

  /** The cuff bracelet pops back onto its home spot on the table. */
  private cuffPropReturn(instant: boolean) {
    this.cuffPropGone = false;
    this.cuffProp.visible = true;
    if (instant) {
      this.cuffProp.position.copy(this.cuffPropHome);
      this.cuffProp.scale.setScalar(1);
      this.cuffPropPopT = 0;
      return;
    }
    this.dustPuff(this.cuffPropHome.clone(), 5);
    this.ringBurst(this.cuffPropHome.clone(), 0.35);
    this.cuffPropPopT = 1; // easeOutBack pop, driven in render()
  }

  /** CUFFS step 1 — pick the bracelet up off the table into your hands. */
  cuffPickupFX(): Promise<void> {
    if (this.cuffPropGone) return Promise.resolve();
    this.cuffPropGone = true;
    const prop = this.cuffProp;
    const from = prop.position.clone();
    const cam = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const to = cam.addScaledVector(dir, 0.55).add(new THREE.Vector3(0.24, -0.16, 0));
    const start = performance.now();
    return new Promise<void>((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / 620);
        const e = 1 - Math.pow(1 - t, 1.7);
        prop.position.lerpVectors(from, to, e);
        prop.position.y += Math.sin(t * Math.PI) * 0.24;
        prop.rotation.z = Math.sin(t * Math.PI * 2.2) * 0.5 * (1 - t);
        prop.lookAt(this.camera.getWorldPosition(new THREE.Vector3()));
        prop.rotateY(0.25);
        prop.scale.setScalar(1 + t * 1.3);
        if (t < 1) requestAnimationFrame(step);
        else {
          prop.visible = false;
          this.ringBurst(to, 0.3);
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  /** The DEALER scoops the bracelet off the table (he is cuffing YOU). */
  cuffGrabFX(): Promise<void> {
    if (this.cuffPropGone) return Promise.resolve();
    this.cuffPropGone = true;
    const prop = this.cuffProp;
    const from = prop.position.clone();
    const to = this.enemyWorldPos().add(new THREE.Vector3(0.18, 0.18, 0.42));
    const start = performance.now();
    return new Promise<void>((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / 480);
        const e = 1 - Math.pow(1 - t, 2);
        prop.position.lerpVectors(from, to, e);
        prop.position.y += Math.sin(t * Math.PI) * 0.2;
        prop.rotation.z = Math.sin(t * Math.PI * 2) * 0.6;
        prop.lookAt(this.camera.getWorldPosition(new THREE.Vector3()));
        prop.scale.setScalar(1 - t * 0.35);
        if (t < 1) requestAnimationFrame(step);
        else {
          prop.visible = false;
          this.sparkBurst(to, 5);
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  /** The voodoo doll rises: for the player it dangles before the camera,
   *  for the DEALER it floats up beside him. It stays while the curse lasts. */
  voodooCastFX(side: "player" | "enemy") {
    this.voodooEndFX(side);
    const attached = side === "player";
    // the player's dangle stays modest; the DEALER's doll is full-size
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(attached ? 0.2 : 0.36, attached ? 0.25 : 0.45),
      new THREE.MeshBasicMaterial({
        map: ctex(texVoodooDoll()),
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
      }),
    );
    mesh.renderOrder = 8;
    if (attached) {
      mesh.position.set(-0.42, -0.18, -0.85);
      this.camera.add(mesh);
    } else {
      mesh.position.copy(this.enemyBasePos).add(new THREE.Vector3(0.62, -0.25, 0.55));
      this.scene.add(mesh);
    }
    mesh.scale.setScalar(0.001);
    this.voodooDolls.set(side, { mesh, born: performance.now(), attached });
    const at = mesh.getWorldPosition(new THREE.Vector3());
    this.ringBurst(at, 0.5);
    for (let i = 0; i < 4; i++) {
      this.spawn(
        this.smokeTex,
        at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.2, 0)),
        {
          size: 0.16 + Math.random() * 0.14,
          vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.3, 0),
          life: 0.9,
          grow: 0.4,
        },
      );
    }
  }

  /** The curse ends: the doll drops away in a puff (no-op if absent). */
  voodooEndFX(side: "player" | "enemy") {
    const d = this.voodooDolls.get(side);
    if (!d) return;
    this.voodooDolls.delete(side);
    const at = d.mesh.getWorldPosition(new THREE.Vector3());
    d.mesh.removeFromParent();
    d.mesh.geometry.dispose();
    (d.mesh.material as THREE.Material).dispose();
    for (let i = 0; i < 3; i++) {
      this.spawn(
        this.smokeTex,
        at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.2, 0)),
        {
          size: 0.15 + Math.random() * 0.12,
          vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.25, 0),
          life: 0.7,
          grow: 0.4,
        },
      );
    }
  }

  /** COFFEE: the drinker's OWN mug rises from their side of the table,
   *  tilts for two real gulps in front of them, then settles back on the
   *  table. You drink yours, THE DEALER drinks his. */
  coffeeDrinkFX(who: "player" | "enemy"): Promise<void> {
    if (this.coffeeBusy) return Promise.resolve();
    this.coffeeBusy = true;
    const cup = this.coffeeCups[who];
    const from = this.coffeeHomes[who].clone();
    const cam = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const to =
      who === "player"
        ? cam.clone().addScaledVector(dir, 0.52).addScaledVector(right, 0.2).add(new THREE.Vector3(0, -0.2, 0))
        : this.enemyWorldPos().add(new THREE.Vector3(-0.05, 0.1, 0.55));
    // rising steam
    for (let i = 0; i < 3; i++) {
      this.spawn(this.smokeTex, from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.1, 0.12, 0)), {
        size: 0.1 + Math.random() * 0.08,
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.1, 0.35, 0),
        life: 0.8,
        grow: 0.35,
      });
    }
    const start = performance.now();
    const DUR = 2100;
    return new Promise<void>((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / DUR);
        if (t < 0.32) {
          const e = 1 - Math.pow(1 - t / 0.32, 2);
          cup.position.lerpVectors(from, to, e);
          cup.position.y += Math.sin((t / 0.32) * Math.PI) * 0.18;
          cup.rotation.z = Math.sin((t / 0.32) * Math.PI) * 0.2;
        } else if (t < 0.68) {
          cup.position.copy(to);
          const g = (t - 0.32) / 0.36;
          cup.rotation.z = 0.2 + Math.sin(g * Math.PI * 4) * 0.55;
          if (Math.random() < 0.1) {
            this.spawn(this.smokeTex, to.clone(), { size: 0.07, vel: new THREE.Vector3(0, 0.25, 0), life: 0.5 });
          }
        } else {
          const e = (t - 0.68) / 0.32;
          cup.position.lerpVectors(to, from, e * e);
          cup.rotation.z = (1 - e) * 0.2;
        }
        if (t < 1) requestAnimationFrame(step);
        else {
          cup.position.copy(from);
          cup.rotation.z = 0;
          this.coffeeBusy = false;
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  /** The DEALER cuffs YOU: the cuffs fly from him straight into the camera. */
  cuffsAtCameraFX(): Promise<void> {
    const from = this.enemyWorldPos().add(new THREE.Vector3(0.2, 0.25, 0.5));
    const cam = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const to = cam.addScaledVector(dir, 0.5);
    const mat = new THREE.MeshBasicMaterial({
      map: ctex(texCuffsProp()),
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.33), mat);
    mesh.position.copy(from);
    mesh.renderOrder = 9;
    this.scene.add(mesh);
    const start = performance.now();
    return new Promise<void>((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / 850);
        const e = 1 - Math.pow(1 - t, 1.6);
        mesh.position.lerpVectors(from, to, e);
        mesh.position.y += Math.sin(t * Math.PI) * 0.22;
        mesh.lookAt(this.camera.getWorldPosition(new THREE.Vector3()));
        mesh.rotateZ(Math.sin(t * Math.PI * 3) * 0.5);
        mesh.scale.setScalar(0.5 + t * 1.5);
        if (t < 1) requestAnimationFrame(step);
        else {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
          mat.dispose();
          this.addTrauma(0.35);
          this.setAberration(1.6);
          setTimeout(() => this.setAberration(0), 320);
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  /* ---------------- physical shop (items live on the table) ---------------- */

  private buildShop() {
    // dark felt mat marking the shop corner of the table
    this.shopMat = new THREE.Mesh(
      new THREE.CircleGeometry(0.66, 44),
      new THREE.MeshStandardMaterial({ color: 0x1d2b1d, roughness: 0.96 }),
    );
    this.shopMat.rotation.x = -Math.PI / 2;
    this.shopMat.position.set(0.18, 0.9075, 0.06);
    this.shopMat.receiveShadow = true;
    this.shopMat.visible = false;
    this.scene.add(this.shopMat);

    // the little gold bell — ring it to end the break.
    // It sits on the LEFT edge of the table (the old right corner was
    // half out of frame and players never found it).
    const bell = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({
      color: 0xd9a441,
      metalness: 0.62,
      roughness: 0.34,
      emissive: 0x2a1d05,
      emissiveIntensity: 0.6,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.098, 0.026, 20), gold);
    base.castShadow = true;
    bell.add(base);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    dome.position.y = 0.018;
    dome.castShadow = true;
    bell.add(dome);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 8), gold);
    knob.position.y = 0.082;
    bell.add(knob);
    bell.position.set(-0.82, 0.918, 0.06);
    bell.visible = false;
    this.scene.add(bell);
    this.shopBell = bell;

    // static props around the bell: a felt coaster + a handwritten note
    this.bellProps = new THREE.Group();
    const coaster = new THREE.Mesh(
      new THREE.CircleGeometry(0.17, 28),
      new THREE.MeshStandardMaterial({ color: 0x33241c, roughness: 0.97 }),
    );
    coaster.rotation.x = -Math.PI / 2;
    coaster.position.set(-0.82, 0.9078, 0.06);
    coaster.receiveShadow = true;
    this.bellProps.add(coaster);
    const note = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.16),
      doodleMat(ctex(texBellNote()), { lit: true }),
    );
    note.position.set(-1.06, 0.985, 0.1);
    note.rotation.y = 0.42;
    note.rotation.z = -0.08;
    this.bellProps.add(note);
    this.bellProps.visible = false;
    this.scene.add(this.bellProps);

    // invisible but raycastable bell hit area
    this.bellHit = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.34, 0.4),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    this.bellHit.position.set(-0.86, 0.99, 0.06);
    this.bellHit.userData.shop = "bell";
    this.scene.add(this.bellHit);
  }

  private shopTex(key: string, cv: HTMLCanvasElement): THREE.Texture {
    let tex = this.shopTexCache.get(key);
    if (!tex) {
      tex = ctex(cv);
      this.shopTexCache.set(key, tex);
    }
    return tex;
  }

  /** Spawn the offer cards standing on the felt mat. */
  showShopItems(offers: { id: SkillId; price: number; legendary: boolean }[]) {
    this.hideShopItems();
    this.shopMat.visible = true;
    if (this.shopBell) this.shopBell.visible = true;
    this.bellProps.visible = true;
    offers.forEach((o, i) => {
      const group = new THREE.Group();
      const base = new THREE.Vector3(-0.22 + i * 0.42, 0.908, 0.02);

      const back = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.36),
        new THREE.MeshBasicMaterial({ color: o.legendary ? 0xd9c48f : 0xb5ac93 }),
      );
      back.position.y = 0.2;
      back.castShadow = true;
      group.add(back);

      const card = new THREE.Mesh(
        new THREE.PlaneGeometry(0.25, 0.25),
        new THREE.MeshBasicMaterial({ map: this.shopTex(`icon-${o.id}`, texSkillIcon(o.id)), transparent: true, alphaTest: 0.02 }),
      );
      card.position.set(0, 0.2, 0.003);
      group.add(card);

      let glow: THREE.Mesh | null = null;
      if (o.legendary) {
        glow = new THREE.Mesh(
          new THREE.PlaneGeometry(0.46, 0.52),
          new THREE.MeshBasicMaterial({
            color: 0xd9a441,
            transparent: true,
            opacity: 0.14,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        glow.position.set(0, 0.2, -0.004);
        group.add(glow);
      }

      // price tag lying flat in front of the card (flat-lit paper, no bloom)
      const tag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.19, 0.12),
        new THREE.MeshBasicMaterial({
          map: this.shopTex(`tag-${o.id}-${o.price}`, texPriceTag(o.price, o.legendary)),
          transparent: true,
          alphaTest: 0.02,
          color: 0xc9c2b2,
        }),
      );
      tag.rotation.x = -Math.PI / 2 + 0.42;
      tag.position.set(0, 0.012, 0.15);
      group.add(tag);

      // invisible hit area
      const hit = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.52, 0.34),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hit.position.y = 0.16;
      hit.userData.shop = o.id;
      group.add(hit);
      this.shopHitboxes.push(hit);

      group.position.copy(base);
      group.rotation.y = (i - 1) * 0.12;
      group.rotation.x = -0.1;
      this.scene.add(group);
      this.shopItems.set(o.id, {
        group,
        glow,
        hit,
        base,
        idx: i,
        bornAt: performance.now() + i * 120,
        hoverK: 0,
        hoverTarget: 0,
      });
    });
  }

  /** Remove every shop prop from the table — WITH a show: the cards leap
   *  into THE DEALER's waiting hands one by one (spin, shrink, fade), the
   *  bell, the note and the felt mat follow, and a farewell dust puff
   *  closes the stall. */
  hideShopItems() {
    if (!this.shopItems.size && !this.shopMat.visible && !this.shopBell?.visible && !this.bellProps.visible)
      return;
    const now = performance.now();
    let delay = 0;
    for (const [id, it] of this.shopItems) {
      this.vanishAnims.push({
        obj: it.group,
        t0: now + delay,
        from: it.group.position.clone(),
        rot: it.group.rotation.clone(),
        spin: true,
        disposable: true,
      });
      this.shopItems.delete(id);
      delay += 95;
    }
    this.shopHitboxes = [];
    this.shopAnims = [];
    if (this.shopBell?.visible) {
      this.vanishAnims.push({
        obj: this.shopBell,
        t0: now + delay,
        from: this.shopBell.position.clone(),
        rot: this.shopBell.rotation.clone(),
        spin: true,
        disposable: false,
      });
      delay += 120;
    }
    if (this.bellProps.visible) {
      this.vanishAnims.push({
        obj: this.bellProps,
        t0: now + delay,
        from: this.bellProps.position.clone(),
        rot: this.bellProps.rotation.clone(),
        spin: false,
        disposable: false,
      });
      delay += 70;
    }
    if (this.shopMat.visible) {
      this.vanishAnims.push({
        obj: this.shopMat,
        t0: now + delay,
        from: this.shopMat.position.clone(),
        rot: this.shopMat.rotation.clone(),
        spin: false,
        disposable: false,
      });
    }
    this.bellHover = false;
    this.bellRingT = 0;
    this.shopVanishing = true;
    // one farewell dust puff where the stall stood
    this.dustPuff(new THREE.Vector3(0.18, 0.97, 0.08), 7);
  }

  /** Raycast the table props. */
  pickShop(ndc: THREE.Vector2): { type: "item"; id: SkillId } | { type: "bell" } | null {
    if (!this.shopBell?.visible) return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.shopHitboxes, this.bellHit], false);
    if (!hits.length) return null;
    const tag = hits[0].object.userData.shop;
    if (tag === "bell") return { type: "bell" };
    return { type: "item", id: tag as SkillId };
  }

  setShopHover(id: SkillId | "bell" | null) {
    for (const [sid, it] of this.shopItems) it.hoverTarget = id === sid ? 1 : 0;
    this.bellHover = id === "bell";
  }

  /** Screen anchor (percentages) for the HTML tooltip. */
  shopAnchor(id: SkillId | "bell"): { xPct: number; yPct: number } | null {
    const obj = id === "bell" ? this.shopBell : this.shopItems.get(id)?.group;
    if (!obj) return null;
    const wp = obj.getWorldPosition(new THREE.Vector3());
    wp.y += id === "bell" ? 0.2 : 0.45;
    const v = wp.project(this.camera);
    return { xPct: (v.x * 0.5 + 0.5) * 100, yPct: (-v.y * 0.5 + 0.5) * 100 };
  }

  /** A bought item leaps off the table in a burst of sparks. */
  sellShopItem(id: SkillId) {
    const it = this.shopItems.get(id);
    if (!it) return;
    const at = it.group.position.clone().add(new THREE.Vector3(0, 0.28, 0));
    this.ringBurst(at, 0.5);
    this.sparkBurst(at, 12);
    this.shopAnims.push({ id, item: it, t0: performance.now() });
  }

  ringBellAnim() {
    this.bellRingT = 1;
    const at = this.shopBell?.position.clone().add(new THREE.Vector3(0, 0.08, 0));
    if (at) this.sparkBurst(at, 6);
  }

  /* ---------------- spent-shell trail (physical recount) ---------------- */

  /** Every fired shell lands on the table's front edge, in firing order.
   *  Red = live, blue = blank — the round's history stays readable. */
  spawnSpentShell(kind: "live" | "blank", from?: THREE.Vector3) {
    if (this.trailMeshes.length >= 6) return;
    const i = this.trailMeshes.length;
    const to = new THREE.Vector3(-0.28 + i * 0.108, 0.912, 0.335 + (Math.random() - 0.5) * 0.03);
    const start = from?.clone() ?? new THREE.Vector3(0, 1.25, 0.35);
    const mat = new THREE.MeshBasicMaterial({
      map: this.shellTex[kind],
      transparent: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), mat);
    mesh.renderOrder = 6;
    mesh.position.copy(start);
    mesh.scale.setScalar(0.45);
    mesh.userData = { t0: performance.now(), from: start, to, tilt: (Math.random() - 0.5) * 0.85, landed: false };
    this.scene.add(mesh);
    this.trailMeshes.push(mesh);
  }

  /** The dealer sweeps the casings away when the gun gets reloaded. */
  clearSpentShells() {
    if (!this.trailMeshes.length) return;
    const now = performance.now();
    for (const m of this.trailMeshes) {
      this.trailSweeps.push({ mesh: m, t0: now + Math.random() * 130, from: m.position.clone() });
    }
    this.trailMeshes = [];
  }

  private updateTrail(nowMs: number, dt0: number) {
    const camQ = this.camera.getWorldQuaternion(new THREE.Quaternion());
    // landing arcs
    for (const m of this.trailMeshes) {
      const u = m.userData as { t0: number; from: THREE.Vector3; to: THREE.Vector3; tilt: number; landed: boolean };
      const t = Math.min(1, (nowMs - u.t0) / 460);
      if (t < 1) {
        const e = 1 - Math.pow(1 - t, 2);
        m.position.lerpVectors(u.from, u.to, e);
        m.position.y += Math.sin(t * Math.PI) * 0.42;
        m.scale.setScalar(0.45 + 0.55 * e);
      } else if (!u.landed) {
        u.landed = true;
        m.position.copy(u.to);
        m.scale.setScalar(1);
      }
      m.quaternion.copy(camQ);
      m.rotateZ(u.tilt + Math.sin(nowMs / 900 + u.t0) * 0.012);
    }
    // sweeps (fade + fly toward the dealer)
    for (let i = this.trailSweeps.length - 1; i >= 0; i--) {
      const s = this.trailSweeps[i];
      const t = (nowMs - s.t0) / 420;
      if (t < 0) continue;
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      if (t >= 1) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        mat.dispose();
        this.trailSweeps.splice(i, 1);
        continue;
      }
      s.mesh.position.y = s.from.y + t * t * 0.55;
      s.mesh.position.x = s.from.x * (1 - t) + t * 0.1;
      s.mesh.position.z = s.from.z * (1 - t) + t * -0.9;
      s.mesh.scale.setScalar(1 - t * 0.4);
      mat.opacity = 1 - t;
      s.mesh.quaternion.copy(camQ);
      s.mesh.rotateZ(t * 2.2);
    }
    void dt0;
  }

  /* ---------------- helpers ---------------- */

  setLook(nx: number, ny: number) {
    this.lookXT = nx;
    this.lookYT = ny;
  }

  addTrauma(v: number) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  private fovKick = 0;

  fovPunch() {
    this.fovKick = 1;
  }

  setTimeScale(v: number, snap = false) {
    this.timeScaleTarget = v;
    if (snap) this.timeScale = v;
  }

  flash(v = 0.85) {
    this.finalPass.uniforms.uFlash.value = v;
  }

  setAberration(v: number) {
    this.finalPass.uniforms.uAberration.value = v;
  }

  setRedPulse(v: number) {
    this.finalPass.uniforms.uRedPulse.value = v;
  }

  setDesat(v: number) {
    this.finalPass.uniforms.uDesat.value = v;
  }

  setLampBoost(v: number) {
    this.lampBoost = v;
  }

  /* ---------------- graphics quality (SETTINGS) ---------------- */

  /** LOW drops shadows + bloom and renders at 0.75x; MEDIUM balances;
   *  HIGH is the full cinematic pipeline. */
  setQuality(q: "low" | "medium" | "high") {
    if (!this.renderer) return;
    const el = this.renderer.domElement.parentElement;
    const w = el?.clientWidth ?? window.innerWidth;
    const h = el?.clientHeight ?? window.innerHeight;
    const dpr = q === "low" ? 0.75 : q === "medium" ? 1.2 : Math.min(window.devicePixelRatio, 1.75);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    const shadows = q !== "low";
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.spot.castShadow = shadows;
      this.scene.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material) (o.material as THREE.Material).needsUpdate = true;
      });
    }
    this.bloomPass.enabled = q !== "low";
  }

  private spawn(
    tex: THREE.Texture,
    pos: THREE.Vector3,
    opts: {
      size?: number;
      vel?: THREE.Vector3;
      rotVel?: number;
      life?: number;
      grow?: number;
      gravity?: number;
      fadePow?: number;
      blending?: THREE.Blending;
      lit?: boolean;
      parent?: THREE.Object3D;
    } = {},
  ) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: opts.blending ?? THREE.NormalBlending,
      opacity: 1,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(opts.size ?? 0.3, opts.size ?? 0.3), mat);
    mesh.position.copy(pos);
    (opts.parent ?? this.scene).add(mesh);
    // billboard ke kamera untuk partikel dunia
    if (!opts.parent) mesh.lookAt(this.camera.getWorldPosition(new THREE.Vector3()));
    this.particles.push({
      mesh,
      vel: opts.vel ?? new THREE.Vector3(),
      rotVel: opts.rotVel ?? 0,
      life: 0,
      maxLife: opts.life ?? 1,
      grow: opts.grow ?? 0,
      gravity: opts.gravity ?? 0,
      fadePow: opts.fadePow ?? 1,
    });
    return mesh;
  }

  /* ---------------- API VFX ---------------- */

  enemySetMood(mood: EnemyMood) {
    const tex = ctex(texEnemy(mood));
    this.enemyMesh.material.map = tex;
    this.enemyMesh.material.emissiveMap = tex;
    // redupkan respons cahaya agar kertas putih tidak overexposed
    this.enemyMesh.material.color.setScalar(0.62);
    this.enemyMesh.material.emissiveIntensity = 0.5;
    this.enemyMesh.material.needsUpdate = true;
  }

  enemySay(lines: string[], dur = 2.6) {
    const tex = ctex(texSpeech(lines));
    this.speechMesh.material.map = tex;
    this.speechMesh.material.opacity = 1;
    this.speechMesh.material.needsUpdate = true;
    this.speechMesh.scale.set(0.6, 0.6, 1);
    this.speechTimer = dur;
  }

  muzzleFlash() {
    this.muzzleMesh.material.opacity = 1;
    this.muzzleMesh.rotation.z = Math.random() * Math.PI;
    this.muzzleMesh.scale.setScalar(0.8 + Math.random() * 0.4);
    this.muzzleLight.intensity = 55;
    this.flash(0.5);
    this.addTrauma(0.55);
    this.fovPunch();
    // asap
    for (let i = 0; i < 5; i++) {
      const p = this.muzzleMesh.getWorldPosition(new THREE.Vector3());
      p.x += (Math.random() - 0.5) * 0.25;
      p.y += (Math.random() - 0.5) * 0.25;
      this.spawn(this.smokeTex, p, {
        size: 0.22 + Math.random() * 0.2,
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2),
        life: 1.4 + Math.random() * 0.8,
        grow: 0.35,
      });
    }
  }

  bloodBurst(at: "enemy" | "player", big = false) {
    const splat = this.splatTexs[Math.floor(Math.random() * this.splatTexs.length)];
    if (at === "enemy") {
      const p = this.enemyBasePos.clone();
      for (let i = 0; i < (big ? 14 : 7); i++) {
        this.spawn(splat, new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.7, p.y + 0.4 + (Math.random() - 0.5) * 0.9, p.z + 0.1), {
          size: 0.16 + Math.random() * 0.22,
          vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 1.2, 0.4 + Math.random() * 0.8),
          gravity: -4.4,
          rotVel: (Math.random() - 0.5) * 8,
          life: 0.8 + Math.random() * 0.5,
        });
      }
      this.spawn(splat, new THREE.Vector3(p.x, p.y + 0.25, p.z + 0.05), {
        size: big ? 1.7 : 1.1,
        life: 0.75,
        grow: 0.2,
        fadePow: 1.6,
      });
    } else {
      // darah di layar: partikel di depan kamera
      for (let i = 0; i < (big ? 10 : 5); i++) {
        const p = this.camera.getWorldPosition(new THREE.Vector3());
        const dir = this.camera.getWorldDirection(new THREE.Vector3());
        p.addScaledVector(dir, 0.5);
        p.x += (Math.random() - 0.5) * 0.6;
        p.y += (Math.random() - 0.5) * 0.4;
        this.spawn(splat, p, {
          size: 0.14 + Math.random() * 0.2,
          vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.1, 0),
          life: 0.7 + Math.random() * 0.5,
          parent: this.scene,
        });
      }
    }
  }

  ringBurst(at: THREE.Vector3, size = 0.6) {
    this.spawn(this.ringTex, at, { size, life: 0.5, grow: 1.6, fadePow: 1.4 });
  }

  sparkBurst(at: THREE.Vector3, n = 8) {
    for (let i = 0; i < n; i++) {
      this.spawn(this.sparkTex, at, {
        size: 0.1 + Math.random() * 0.12,
        vel: new THREE.Vector3((Math.random() - 0.5) * 2.4, Math.random() * 2, (Math.random() - 0.5) * 1.2),
        gravity: -5,
        rotVel: (Math.random() - 0.5) * 12,
        life: 0.4 + Math.random() * 0.4,
        blending: THREE.AdditiveBlending,
      });
    }
  }

  dustPuff(at: THREE.Vector3, n = 6) {
    for (let i = 0; i < n; i++) {
      this.spawn(this.dustTex, at, {
        size: 0.2 + Math.random() * 0.25,
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.2 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5),
        life: 0.7 + Math.random() * 0.5,
        grow: 0.5,
      });
    }
  }

  /** Shell melayang (reload / eject). onDone dipanggil saat selesai. */
  flyShell(kind: "live" | "blank", from: THREE.Vector3, to: THREE.Vector3, dur: number, onDone?: () => void) {
    const mat = new THREE.MeshBasicMaterial({ map: this.shellTex[kind], transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), mat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / (dur * 1000));
      const e = 1 - Math.pow(1 - t, 2);
      mesh.position.lerpVectors(from, to, e);
      mesh.position.y += Math.sin(t * Math.PI) * 0.55;
      mesh.rotation.z += 0.22;
      mesh.lookAt(this.camera.getWorldPosition(new THREE.Vector3()));
      if (t < 1) requestAnimationFrame(step);
      else {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mat.dispose();
        onDone?.();
      }
    };
    requestAnimationFrame(step);
  }

  /* ---------------- gun pose ---------------- */

  gunAim(pose: "enemy" | "self" | null, instant = false) {
    this.gunPose = pose;
    this.gunMesh.visible = pose !== null;
    if (pose === "enemy") {
      this.gunMesh.material.map = this.gunAimTex.enemy;
      this.gunTarget.set(0, -0.52, -0.8);
      this.gunMesh.scale.setScalar(1);
    } else if (pose === "self") {
      this.gunMesh.material.map = this.gunAimTex.self;
      this.gunTarget.set(0.52, -0.38, -0.95);
      this.gunMesh.scale.setScalar(0.92);
    }
    if (instant) this.gunCurrent.copy(this.gunTarget);
    this.gunMesh.material.needsUpdate = true;
  }

  gunOpenCylinder(open: boolean) {
    this.gunMesh.visible = true;
    this.gunMesh.material.map = open ? this.gunAimTex.open : this.gunAimTex.enemy;
    this.gunMesh.material.needsUpdate = true;
  }

  gunKick() {
    this.gunRecoil = 1;
  }

  /** PEEK: the revolver swings up CLOSE to your eyes, cylinder swung open. */
  gunPeek(show: boolean) {
    this.gunPeeking = show;
    if (show) {
      this.gunMesh.visible = true;
      this.gunMesh.material.map = this.gunAimTex.open;
      this.gunTarget.set(0.12, -0.1, -0.48); // right up against the lens
      this.gunMesh.scale.setScalar(1.08);
    } else {
      this.gunTarget.set(0, -0.52, -0.8);
      this.gunMesh.scale.setScalar(1);
      if (this.gunPose === null) this.gunMesh.visible = false;
    }
    this.gunMesh.material.needsUpdate = true;
  }

  /** REROLL: the revolver leaps up and spins fate around. */
  gunSpinFX() {
    this.gunMesh.visible = true;
    this.gunMesh.material.map = this.gunAimTex.enemy;
    this.gunMesh.material.needsUpdate = true;
    this.gunTarget.set(0, -0.4, -0.68);
    this.gunSpinT = 1;
  }

  gunSpinEnd() {
    this.gunSpinT = 0;
    this.gunTarget.set(0, -0.52, -0.8);
    if (this.gunPose === null && !this.gunPeeking) this.gunMesh.visible = false;
  }

  /* ---------------- dice ---------------- */

  diceSetFace(id: string, cv: HTMLCanvasElement) {
    let tex = this.diceFaceTex[id];
    if (!tex) {
      tex = ctex(cv);
      this.diceFaceTex[id] = tex;
    }
    this.diceMesh.material.map = tex;
    this.diceMesh.material.needsUpdate = true;
  }

  diceVisible(v: boolean) {
    this.diceMesh.visible = v;
    this.diceGhosts.forEach((g) => (g.visible = v));
    this.diceMesh.material.opacity = v ? 1 : 0;
    if (!v) {
      this.diceGhosts.forEach((g) => (g.material.opacity = 0));
    }
  }

  diceMeshes() {
    return { main: this.diceMesh, ghosts: this.diceGhosts };
  }

  /* ---------------- posisi util ---------------- */

  muzzleWorldPos(): THREE.Vector3 {
    return this.muzzleMesh.getWorldPosition(new THREE.Vector3());
  }

  enemyWorldPos(): THREE.Vector3 {
    return this.enemyMesh.position.clone();
  }

  dustPuffAtCamera() {
    const p = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    p.addScaledVector(dir, 0.7);
    p.y -= 0.1;
    for (let i = 0; i < 4; i++) {
      this.spawn(this.smokeTex, p, {
        size: 0.16 + Math.random() * 0.18,
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.3 + Math.random() * 0.3, 0),
        life: 0.9 + Math.random() * 0.5,
        grow: 0.4,
      });
    }
  }

  /* ---------------- render loop ---------------- */

  render(now: number) {
    const dt0 = Math.min(0.1, (now - (this.lastNow ?? now)) / 1000);
    this.lastNow = now;
    this.timeScale += (this.timeScaleTarget - this.timeScale) * Math.min(1, dt0 * 6);
    const dt = dt0 * this.timeScale;
    const t = now / 1000;

    // kamera: parallax + napas + shake
    this.lookX += (this.lookXT - this.lookX) * Math.min(1, dt0 * 5);
    this.lookY += (this.lookYT - this.lookY) * Math.min(1, dt0 * 5);
    this.trauma = Math.max(0, this.trauma - dt0 * 1.7);
    const sh = this.trauma * this.trauma;
    const n1 = Math.sin(t * 61) * Math.sin(t * 23.7);
    const n2 = Math.cos(t * 47.3) * Math.sin(t * 31.1);
    this.shakeOff.set(n1 * sh * 0.09, n2 * sh * 0.07);

    this.camGroup.rotation.y = -this.lookX * 0.09 + n1 * sh * 0.05;
    this.camGroup.rotation.x = -this.lookY * 0.06 + n2 * sh * 0.045;
    this.camGroup.position.x = this.shakeOff.x;
    this.camGroup.position.y = Math.sin(t * 1.7) * 0.012 + this.shakeOff.y;

    // camera dolly: the interrogation push-in toward THE DEALER
    this.camRig.position.lerp(this.dollyTarget, Math.min(1, dt0 * 3.2));

    // lampu flicker
    this.lampFlicker += (1 - this.lampFlicker) * Math.min(1, dt0 * 8);
    if (Math.random() < 0.012) this.lampFlicker = 0.55 + Math.random() * 0.3;
    const flick = this.lampFlicker * this.lampBoost * (0.92 + Math.sin(t * 13.3) * 0.05);
    this.spot.intensity = 85 * flick;
    this.ambience.intensity = 0.55 * flick;
    this.lampPivot.rotation.z = Math.sin(t * 0.9) * 0.035;
    this.lampPivot.rotation.x = Math.cos(t * 0.7) * 0.02;

    // enemy: idle bobbing
    this.enemyWobble += dt;
    this.enemyMesh.position.y = this.enemyBasePos.y + Math.sin(t * 1.9) * 0.02;
    this.enemyMesh.rotation.z = Math.sin(t * 1.3) * 0.012;

    // speech bubble
    if (this.speechTimer > 0) {
      this.speechTimer -= dt0;
      const s = Math.min(1, this.speechMesh.scale.x + dt0 * 5);
      this.speechMesh.scale.set(s, s, 1);
      if (this.speechTimer <= 0) {
        this.speechMesh.material.opacity = 0;
      }
    }

    // gun lerp + recoil
    this.gunCurrent.lerp(this.gunTarget, Math.min(1, dt0 * 7));
    this.gunRecoil = Math.max(0, this.gunRecoil - dt0 * 5.5);
    this.fovKick = Math.max(0, this.fovKick - dt0 * 4);
    const targetFov = 56 + this.fovKick * 4.5;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }
    this.gunMesh.position.copy(this.gunCurrent);
    this.gunMesh.position.z += this.gunRecoil * 0.22;
    this.gunMesh.rotation.x = this.gunRecoil * 0.3 - Math.sin(t * 1.7) * 0.008;
    this.gunMesh.rotation.z = this.gunPose === "self" ? -0.06 : Math.sin(t * 1.4) * 0.006;
    if (this.gunSpinT > 0) {
      this.gunSpinT = Math.max(0, this.gunSpinT - dt0 * 1.35);
      this.gunMesh.rotation.z += this.gunSpinT * this.gunSpinT * 0.55 + this.gunSpinT * 0.22;
    }

    // muzzle fade
    if (this.muzzleMesh.material.opacity > 0) {
      this.muzzleMesh.material.opacity = Math.max(0, this.muzzleMesh.material.opacity - dt0 * 7);
      this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt0 * 260);
    }

    // flash & pulse fade
    const u = this.finalPass.uniforms;
    u.uFlash.value = Math.max(0, u.uFlash.value - dt0 * 2.6);
    u.uTime.value = t;

    // partikel
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      const k = p.life / p.maxLife;
      if (k >= 1) {
        (p.mesh.parent ?? this.scene).remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.z += p.rotVel * dt;
      const sc = 1 + p.grow * p.life;
      p.mesh.scale.set(sc, sc, 1);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - k, p.fadePow);
    }

    // physical shop: pop-in, bob, hover lift, bell ring, sold-item fly-off
    const nowMs = performance.now();
    if (this.shopItems.size || this.shopAnims.length) {
      for (const [, it] of this.shopItems) {
        it.hoverK += (it.hoverTarget - it.hoverK) * Math.min(1, dt0 * 11);
        const pop = Math.min(1, Math.max(0, (nowMs - it.bornAt) / 380));
        const e = 1 + 2.7 * Math.pow(pop - 1, 3) + 1.7 * Math.pow(pop - 1, 2); // easeOutBack
        const s = (pop <= 0 ? 0 : e) * (1 + it.hoverK * 0.15);
        it.group.scale.setScalar(Math.max(0.001, s));
        it.group.position.y = it.base.y + Math.sin(t * 2.1 + it.idx * 1.9) * 0.008 + it.hoverK * 0.045;
        if (it.glow) {
          (it.glow.material as THREE.MeshBasicMaterial).opacity =
            0.12 + Math.sin(t * 3.1 + it.idx * 2.2) * 0.05 + it.hoverK * 0.16;
        }
      }
      for (let i = this.shopAnims.length - 1; i >= 0; i--) {
        const a = this.shopAnims[i];
        const k = (nowMs - a.t0) / 620;
        if (k >= 1) {
          this.scene.remove(a.item.group);
          a.item.group.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              o.geometry.dispose();
              (o.material as THREE.Material).dispose();
            }
          });
          this.shopHitboxes = this.shopHitboxes.filter((h) => h !== a.item.hit);
          this.shopItems.delete(a.id);
          this.shopAnims.splice(i, 1);
        } else {
          a.item.group.position.y = a.item.base.y + k * k * 1.25;
          a.item.group.rotation.z = k * 2.6;
          a.item.group.rotation.y += dt0 * 6;
          a.item.group.scale.setScalar(Math.max(0.001, 1 - k));
        }
      }
    }
    // shop vanish: the props leap into THE DEALER's hands, spin, shrink, fade
    if (this.vanishAnims.length) {
      for (let i = this.vanishAnims.length - 1; i >= 0; i--) {
        const v = this.vanishAnims[i];
        const k = (nowMs - v.t0) / 620;
        if (k < 0) continue;
        if (k >= 1) {
          if (v.disposable) {
            this.scene.remove(v.obj);
            v.obj.traverse((o) => {
              if (o instanceof THREE.Mesh) {
                o.geometry.dispose();
                (o.material as THREE.Material).dispose();
              }
            });
          } else {
            // persistent props (bell / mat / coaster set) rest until the next break
            v.obj.visible = false;
            v.obj.position.copy(v.from);
            v.obj.rotation.copy(v.rot);
            v.obj.scale.setScalar(1);
            v.obj.traverse((o) => {
              const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
              if (m && "opacity" in m) m.opacity = 1;
            });
          }
          this.vanishAnims.splice(i, 1);
          continue;
        }
        const e = k * k;
        v.obj.position.set(
          v.from.x + (0.1 - v.from.x) * e,
          v.from.y + Math.sin(Math.min(1, k) * Math.PI) * 0.42 + e * 0.5,
          v.from.z + (-1.3 - v.from.z) * e,
        );
        v.obj.scale.setScalar(Math.max(0.02, 1 - k * 0.95));
        if (v.spin) v.obj.rotation.y += dt0 * 9;
        v.obj.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (m && "opacity" in m) {
            m.transparent = true;
            m.opacity = 1 - k;
          }
        });
      }
    } else if (this.shopVanishing) {
      this.shopVanishing = false;
    }
    if (this.shopBell && !this.shopVanishing) {
      const b = this.shopBell;
      this.bellHoverK += ((this.bellHover ? 1 : 0) - this.bellHoverK) * Math.min(1, dt0 * 10);
      b.position.y = 0.918 + this.bellHoverK * 0.05;
      if (this.bellRingT > 0) {
        this.bellRingT = Math.max(0, this.bellRingT - dt0 * 1.15);
        b.rotation.z = Math.sin(this.bellRingT * Math.PI * 7) * 0.38 * this.bellRingT;
      } else if (b.visible) {
        b.rotation.z = Math.sin(t * 1.2) * 0.02;
      }
    }

    // skill props: cuffs snap-pop, cuff-bracelet idle shimmer, voodoo dolls
    // dangling, coffee mugs idly breathing on their sides of the table
    if (this.cuffsMesh.visible) {
      const cq = this.camera.getWorldQuaternion(new THREE.Quaternion());
      this.cuffsMesh.quaternion.copy(cq);
      if (this.cuffsPopT > 0) {
        this.cuffsPopT = Math.max(0, this.cuffsPopT - dt0 * 2.2);
        const p = 1 - this.cuffsPopT;
        const e = 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2); // easeOutBack
        this.cuffsMesh.scale.setScalar(Math.max(0.01, e));
      } else {
        this.cuffsMesh.scale.setScalar(1);
        this.cuffsMesh.position.y = this.enemyBasePos.y - 0.34 + Math.sin(t * 2.4) * 0.012;
        this.cuffsMesh.rotateZ(Math.sin(t * 1.7) * 0.035);
      }
    }
    // the cuff bracelet on the table: gentle bob, and a pop when it returns
    if (this.cuffProp.visible) {
      this.cuffProp.position.y = this.cuffPropHome.y + Math.sin(t * 1.9) * 0.006;
      this.cuffProp.rotation.z = Math.sin(t * 1.3) * 0.02;
      if (this.cuffPropPopT > 0) {
        this.cuffPropPopT = Math.max(0, this.cuffPropPopT - dt0 * 2.4);
        const p = 1 - this.cuffPropPopT;
        const e = 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2);
        this.cuffProp.scale.setScalar(Math.max(0.01, e));
      }
    }
    for (const [, d] of this.voodooDolls) {
      const pop = Math.min(1, (nowMs - d.born) / 480);
      const e = 1 + 2.7 * Math.pow(pop - 1, 3) + 1.7 * Math.pow(pop - 1, 2); // easeOutBack
      d.mesh.scale.setScalar(Math.max(0.001, e));
      if (d.attached) {
        d.mesh.position.y = -0.05 + Math.sin(t * 2.2) * 0.022;
        d.mesh.rotation.z = Math.sin(t * 1.5) * 0.08;
      } else {
        const wq = this.camera.getWorldQuaternion(new THREE.Quaternion());
        d.mesh.quaternion.copy(wq);
        d.mesh.rotateZ(Math.sin(t * 1.5) * 0.08);
        d.mesh.position.y = this.enemyBasePos.y - 0.25 + Math.sin(t * 2.2) * 0.022;
      }
    }
    if (!this.coffeeBusy) {
      for (const side of ["player", "enemy"] as const) {
        const cup = this.coffeeCups[side];
        cup.position.y = this.coffeeHomes[side].y + Math.sin(t * 1.8 + (side === "enemy" ? 2.1 : 0)) * 0.004;
      }
    }

    // spent-shell trail: land, billboard toward the camera
    this.updateTrail(nowMs, dt0);

    this.onFrame?.(dt, t);
    this.composer.render();
  }

  private lastNow: number | null = null;

  dispose() {
    window.removeEventListener("resize", this.onResize);
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
  }
}
