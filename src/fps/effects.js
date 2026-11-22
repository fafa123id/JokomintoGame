import * as THREE from "/asset/vendor/three/three.module.min.js";

// Visuals for hero abilities. sync() mirrors the effect list from each snapshot (creating, moving
// and removing meshes by id); one-off events (explosions, scans, beams) animate and clean up.
// Everything placed by your team is green, by the enemy red, so you can tell them apart at a glance.
const ALLY = 0x34d399;
const ENEMY = 0xff4545;

function softTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class EffectsView {
  constructor(scene, { myTeam }) {
    this.scene = scene;
    this.myTeam = myTeam;
    this.items = new Map();
    this.events = [];
    this.soft = softTexture();
    this.mats = {
      smoke: new THREE.SpriteMaterial({ map: this.soft, color: 0xaab0b9, transparent: true, opacity: 1, depthWrite: false }),
      smokeCore: new THREE.MeshBasicMaterial({ color: 0xa3a9b2, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide }),
      smokeShell: new THREE.MeshBasicMaterial({ color: 0xb4b9c1, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.BackSide }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 }),
      led: new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false }),
      flash: new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    };
    this.geo = {
      sphere: new THREE.SphereGeometry(1, 20, 14),
      dome: new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      ring: new THREE.RingGeometry(0.92, 1, 48),
      disc: new THREE.CircleGeometry(1, 40),
      torus: new THREE.TorusGeometry(1, 0.06, 8, 40),
      box: new THREE.BoxGeometry(1, 1, 1),
      small: new THREE.SphereGeometry(0.09, 10, 8),
      rotor: new THREE.BoxGeometry(0.22, 0.01, 0.03),
    };
  }

  teamColor(team) {
    return team === this.myTeam ? ALLY : ENEMY;
  }

  glow(color, opacity) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
  }

  flatOnGround(mesh, y = 0.03) {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    return mesh;
  }

  build(e) {
    const g = new THREE.Group();
    const color = this.teamColor(e.team);
    const own = e.team === this.myTeam;
    const parts = {};
    switch (e.type) {
      case "smoke": {
        // Overlapping soft puffs plus a core so it really blocks the view.
        const core = new THREE.Mesh(this.geo.sphere, this.mats.smokeCore);
        core.scale.setScalar(e.r * 0.85);
        g.add(core);
        parts.core = core;
        // Seen from inside your own smoke: just a hazy wall around you.
        const shell = new THREE.Mesh(this.geo.sphere, this.mats.smokeShell);
        shell.scale.setScalar(e.r * 0.95);
        shell.visible = false;
        g.add(shell);
        parts.shell = shell;
        parts.r = e.r;
        parts.ally = e.team === this.myTeam;
        parts.puffs = [];
        const count = Math.round(10 + e.r * 3);
        for (let i = 0; i < count; i++) {
          const s = new THREE.Sprite(this.mats.smoke);
          const dir = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.3) * 0.8, Math.random() - 0.5).normalize();
          s.position.copy(dir.multiplyScalar(Math.random() * e.r * 0.8));
          s.scale.setScalar(e.r * (0.9 + Math.random() * 0.7));
          s.userData.spin = (Math.random() - 0.5) * 0.2;
          parts.puffs.push(s);
          g.add(s);
        }
        g.position.set(e.x, e.y, e.z);
        g.scale.setScalar(0.2);
        break;
      }
      case "fence": {
        // Posts with crackling wires: green for your team's fence, red for the enemy's.
        const long = e.x1 - e.x0 > e.z1 - e.z0;
        const len = long ? e.x1 - e.x0 : e.z1 - e.z0;
        const posts = Math.round(len / 2) + 1;
        for (let i = 0; i < posts; i++) {
          const post = new THREE.Mesh(this.geo.box, this.mats.dark);
          post.scale.set(0.12, e.h, 0.12);
          const t = i / (posts - 1) - 0.5;
          post.position.set((e.x0 + e.x1) / 2 + (long ? t * len : 0), e.h / 2, (e.z0 + e.z1) / 2 + (long ? 0 : t * len));
          g.add(post);
        }
        parts.wires = [];
        for (const y of [0.5, 1.2, 1.9, 2.5]) {
          const wire = new THREE.Mesh(this.geo.box, this.glow(color, 0.85));
          wire.scale.set(long ? len : 0.04, 0.04, long ? 0.04 : len);
          wire.position.set((e.x0 + e.x1) / 2, y, (e.z0 + e.z1) / 2);
          parts.wires.push(wire);
          g.add(wire);
        }
        const field = new THREE.Mesh(this.geo.box, this.glow(color, 0.12));
        field.scale.set(long ? len : 0.05, e.h, long ? 0.05 : len);
        field.position.set((e.x0 + e.x1) / 2, e.h / 2, (e.z0 + e.z1) / 2);
        g.add(field);
        break;
      }
      case "wall":
      case "barrier": {
        const wall = e.type === "wall";
        const mat = wall
          ? new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: 0.9, emissive: color, emissiveIntensity: 0.22 })
          : new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.38, emissive: color, emissiveIntensity: 0.6, roughness: 0.2, depthWrite: false });
        const mesh = new THREE.Mesh(this.geo.box, mat);
        mesh.scale.set(e.x1 - e.x0, e.h, e.z1 - e.z0);
        mesh.position.set((e.x0 + e.x1) / 2, e.h / 2, (e.z0 + e.z1) / 2);
        mesh.castShadow = wall;
        g.add(mesh);
        parts.mesh = mesh;
        parts.h = e.h;
        parts.rise = performance.now();
        break;
      }
      case "slow":
      case "heal":
      case "barrage":
      case "vortex":
      case "laser": {
        const tint = color;
        const ring = this.flatOnGround(new THREE.Mesh(this.geo.ring, this.glow(tint, 0.9)), 0.04);
        const fill = this.flatOnGround(new THREE.Mesh(this.geo.disc, this.glow(tint, 0.16)), 0.035);
        ring.scale.setScalar(e.r);
        fill.scale.setScalar(e.r);
        g.add(ring, fill);
        parts.ring = ring;
        parts.fill = fill;
        if (e.type === "laser") {
          // A ring of beams from the sky, switched on when the zone arms.
          parts.beams = new THREE.Group();
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            const d = Math.sqrt(Math.random()) * e.r * 0.9;
            const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 12, 6), this.glow(tint, 0.9));
            beam.position.set(Math.cos(a) * d, 6, Math.sin(a) * d);
            beam.userData.a = a;
            beam.userData.d = d;
            parts.beams.add(beam);
          }
          parts.beams.visible = false;
          g.add(parts.beams);
        }
        if (e.type === "vortex") {
          parts.spin = new THREE.Mesh(this.geo.torus, this.glow(tint, 0.7));
          parts.spin.rotation.x = Math.PI / 2;
          parts.spin.position.y = 1;
          parts.spin.scale.setScalar(e.r * 0.6);
          g.add(parts.spin);
        }
        g.position.set(e.x, 0, e.z);
        break;
      }
      case "boost": {
        const pad = this.flatOnGround(new THREE.Mesh(this.geo.disc, this.glow(color, 0.35)), 0.05);
        pad.scale.setScalar(e.r);
        const ring = this.flatOnGround(new THREE.Mesh(this.geo.ring, this.glow(color, 1)), 0.06);
        ring.scale.setScalar(e.r);
        g.add(pad, ring);
        parts.ring = ring;
        g.position.set(e.x, 0, e.z);
        break;
      }
      case "grenade": {
        const body = new THREE.Mesh(this.geo.small, new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.5 }));
        const led = new THREE.Mesh(this.geo.small, this.mats.led);
        led.scale.setScalar(0.35);
        led.position.y = 0.08;
        g.add(body, led);
        parts.led = led;
        g.position.set(e.x, e.y, e.z);
        break;
      }
      case "dome": {
        const dome = new THREE.Mesh(this.geo.dome, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.22, emissive: color, emissiveIntensity: 0.7, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide, wireframe: false }));
        // Arcs crawling over the electric shell.
        const arcs = new THREE.Mesh(this.geo.dome, new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.25, toneMapped: false }));
        arcs.scale.setScalar(e.r * 1.01);
        g.add(arcs);
        parts.arcs = arcs;
        dome.scale.setScalar(e.r);
        const rim = this.flatOnGround(new THREE.Mesh(this.geo.ring, this.glow(color, 0.8)), 0.04);
        rim.scale.setScalar(e.r);
        g.add(dome, rim);
        parts.dome = dome;
        g.position.set(e.x, 0, e.z);
        break;
      }
      case "baton": {
        // A spinning stick of crackling light.
        const rod = new THREE.Mesh(this.geo.box, this.glow(color, 1));
        rod.scale.set(0.06, 0.06, 0.6);
        g.add(rod);
        parts.rod = rod;
        g.position.set(e.x, e.y, e.z);
        break;
      }
      case "scout":
      case "drone": {
        const body = new THREE.Mesh(this.geo.box, this.mats.dark);
        body.scale.set(0.3, 0.08, 0.3);
        g.add(body);
        parts.rotors = [];
        for (const [x, z] of [[0.18, 0.18], [-0.18, 0.18], [0.18, -0.18], [-0.18, -0.18]]) {
          const r = new THREE.Mesh(this.geo.rotor, this.mats.dark);
          r.position.set(x, 0.06, z);
          parts.rotors.push(r);
          g.add(r);
        }
        const led = new THREE.Mesh(this.geo.small, this.glow(color, 1));
        led.scale.setScalar(0.4);
        led.position.y = -0.05;
        g.add(led);
        parts.led = led;
        if (e.type === "scout") g.scale.setScalar(0.7);
        g.position.set(e.x, e.y, e.z);
        break;
      }
      default:
        return null;
    }
    this.scene.add(g);
    return { group: g, parts, type: e.type, born: performance.now(), target: new THREE.Vector3(e.x ?? 0, e.y ?? 0, e.z ?? 0) };
  }

  sync(list) {
    const keep = new Set();
    for (const e of list ?? []) {
      keep.add(e.id);
      let item = this.items.get(e.id);
      if (!item) {
        item = this.build(e);
        if (!item) continue;
        this.items.set(e.id, item);
      }
      if (e.x !== undefined) item.target.set(e.x, e.y ?? 0, e.z);
      // Moving shields: follow the block.
      if (e.x0 !== undefined && item.parts.mesh) {
        item.parts.mesh.scale.x = e.x1 - e.x0;
        item.parts.mesh.scale.z = e.z1 - e.z0;
        item.parts.mesh.position.x = (e.x0 + e.x1) / 2;
        item.parts.mesh.position.z = (e.z0 + e.z1) / 2;
      }
      item.data = e;
    }
    for (const [id, item] of this.items) {
      if (keep.has(id)) continue;
      this.remove(item);
      this.items.delete(id);
    }
  }

  remove(item) {
    this.scene.remove(item.group);
    item.group.traverse((o) => {
      if (o.material && !Object.values(this.mats).includes(o.material)) o.material.dispose();
    });
  }

  // ---------- deploy preview ----------

  // shape: { kind: "circle", at, r } | { kind: "wall", box } | { kind: "arc", points } | null
  preview(shape) {
    if (!this.ghost) {
      const mat = this.glow(ALLY, 0.35);
      this.ghost = {
        ring: this.flatOnGround(new THREE.Mesh(this.geo.ring, this.glow(ALLY, 0.95)), 0.05),
        fill: this.flatOnGround(new THREE.Mesh(this.geo.disc, mat), 0.045),
        wall: new THREE.Mesh(this.geo.box, this.glow(ALLY, 0.3)),
        arc: new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: ALLY, dashSize: 0.3, gapSize: 0.2, toneMapped: false })),
        land: this.flatOnGround(new THREE.Mesh(this.geo.ring, this.glow(ALLY, 0.95)), 0.05),
      };
      for (const m of Object.values(this.ghost)) {
        m.visible = false;
        this.scene.add(m);
      }
    }
    const gh = this.ghost;
    for (const m of Object.values(gh)) m.visible = false;
    if (!shape) return;
    if (shape.kind === "circle") {
      for (const m of [gh.ring, gh.fill]) {
        m.visible = true;
        m.scale.setScalar(shape.r);
        m.position.x = shape.at.x;
        m.position.z = shape.at.z;
      }
    } else if (shape.kind === "wall") {
      const b = shape.box;
      gh.wall.visible = true;
      gh.wall.scale.set(b.x1 - b.x0, b.h, b.z1 - b.z0);
      gh.wall.position.set((b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2);
    } else if (shape.kind === "arc") {
      gh.arc.geometry.dispose();
      gh.arc.geometry = new THREE.BufferGeometry().setFromPoints(shape.points.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
      gh.arc.computeLineDistances();
      gh.arc.visible = true;
      const end = shape.points.at(-1);
      gh.land.visible = true;
      gh.land.scale.setScalar(5);
      gh.land.position.x = end.x;
      gh.land.position.z = end.z;
    }
  }

  // ---------- one-off events ----------

  explosion(x, y, z, r) {
    const flash = new THREE.Mesh(this.geo.sphere, this.mats.flash.clone());
    flash.position.set(x, y, z);
    this.scene.add(flash);
    const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.soft, color: 0x5b5550, transparent: true, opacity: 0.8, depthWrite: false }));
    smoke.position.set(x, y + 0.5, z);
    this.scene.add(smoke);
    this.events.push({ kind: "boom", objects: [flash, smoke], flash, smoke, r, start: performance.now(), life: 900 });
  }

  wave(x, z, color, maxR, life = 700, arc = Math.PI * 2, yaw = 0) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48, 1, 0, arc), this.glow(color, 0.8));
    ring.rotation.x = -Math.PI / 2;
    // Arc centered on the facing direction (forward is -sin/-cos of yaw).
    ring.rotation.z = Math.atan2(-Math.cos(yaw), -Math.sin(yaw)) - arc / 2;
    ring.position.set(x, 0.08, z);
    this.scene.add(ring);
    this.events.push({ kind: "wave", objects: [ring], ring, maxR, start: performance.now(), life });
  }

  beam(from, to, color = 0xb06bff) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, toneMapped: false }));
    this.scene.add(line);
    this.events.push({ kind: "beam", objects: [line], line, start: performance.now(), life: 350 });
  }

  column(x, z, color = 0x86efac) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 6, 20, 1, true), this.glow(color, 0.5));
    mesh.position.set(x, 3, z);
    this.scene.add(mesh);
    this.events.push({ kind: "column", objects: [mesh], mesh, start: performance.now(), life: 1000 });
  }

  // ---------- per frame ----------

  // Returns "ally" | "enemy" | null: the kind of smoke the camera is in this frame.
  update(t, dt, camera) {
    this.insideSmoke = null;
    for (const item of this.items.values()) {
      const g = item.group;
      const age = (t - item.born) / 1000;
      const p = item.parts;
      if (item.type === "smoke") {
        const grow = Math.min(1, 0.2 + age * 2.5);
        g.scale.setScalar(grow);
        for (const s of p.puffs) s.material.rotation += s.userData.spin * dt;
        // Inside a cloud: your own is clear inside with a hazy wall; the enemy's is thick.
        const inside = camera && camera.position.distanceTo(g.position) < p.r * grow * 0.95;
        const ally = inside && p.ally;
        p.core.visible = !ally;
        p.shell.visible = ally;
        for (const s of p.puffs) s.visible = !inside;
        if (inside) this.insideSmoke = ally ? "ally" : "enemy";
      } else if (item.type === "baton") {
        g.position.lerp(item.target, Math.min(1, dt * 20));
        p.rod.rotation.x += dt * 25;
        p.rod.material.opacity = 0.6 + Math.random() * 0.4;
      } else if (item.type === "grenade" || item.type === "drone" || item.type === "scout") {
        g.position.lerp(item.target, Math.min(1, dt * 14));
        p.led.visible = Math.floor(t / (item.type === "grenade" ? 120 : 300)) % 2 === 0;
        if (p.rotors) for (const r of p.rotors) r.rotation.y += dt * 40;
      } else if (item.type === "laser") {
        // Warning: the ring flashes faster as it arms; then the beams sweep the zone.
        const armIn = item.data?.armIn ?? 0;
        const armed = armIn <= 0;
        p.ring.material.opacity = armed ? 1 : Math.floor(t / (armIn < 1500 ? 90 : 220)) % 2 ? 0.95 : 0.25;
        p.fill.material.opacity = armed ? 0.3 : 0.12;
        p.beams.visible = armed;
        if (armed) {
          for (const b of p.beams.children) {
            b.userData.a += dt * 2.5;
            b.position.set(Math.cos(b.userData.a) * b.userData.d, 6, Math.sin(b.userData.a) * b.userData.d);
          }
        }
      } else if (item.type === "fence") {
        for (const w of p.wires) w.material.opacity = 0.4 + Math.random() * 0.6;
      } else if (item.type === "dome") {
        p.arcs.material.opacity = 0.1 + Math.random() * 0.3;
        p.arcs.rotation.y += dt * 0.8;
      } else if (p.ring && item.type !== "boost") {
        p.ring.material.opacity = 0.6 + Math.sin(t / 180) * 0.3;
        if (p.spin) p.spin.rotation.z += dt * 6;
      } else if (item.type === "boost") {
        p.ring.scale.setScalar(1.1 + ((t / 600) % 1) * 0.5);
        p.ring.material.opacity = 1 - ((t / 600) % 1);
      } else if (p.mesh) {
        // Walls rise out of the ground.
        const k = Math.max(0.02, Math.min(1, (t - p.rise) / 250));
        p.mesh.scale.y = p.h * k;
        p.mesh.position.y = (p.h * k) / 2;
      } else if (p.led) {
        p.led.visible = Math.floor(t / 700) % 2 === 0;
      }
    }
    this.events = this.events.filter((ev) => {
      const k = (t - ev.start) / ev.life;
      if (k >= 1) {
        for (const o of ev.objects) {
          this.scene.remove(o);
          if (o.geometry && !Object.values(this.geo).includes(o.geometry)) o.geometry.dispose();
          o.material?.dispose();
        }
        return false;
      }
      if (ev.kind === "boom") {
        ev.flash.scale.setScalar(ev.r * Math.min(1, k * 4) * 0.9);
        ev.flash.material.opacity = Math.max(0, 1 - k * 2.2);
        ev.smoke.scale.setScalar(ev.r * (0.6 + k * 1.4));
        ev.smoke.position.y += dt * 0.8;
        ev.smoke.material.opacity = 0.8 * (1 - k);
      } else if (ev.kind === "wave") {
        ev.ring.scale.setScalar(Math.max(0.1, ev.maxR * k));
        ev.ring.material.opacity = 0.9 * (1 - k);
      } else if (ev.kind === "beam") {
        ev.line.material.opacity = 1 - k;
      } else if (ev.kind === "column") {
        ev.mesh.material.opacity = 0.5 * (1 - k);
        ev.mesh.scale.set(1 - k * 0.5, 1, 1 - k * 0.5);
      }
      return true;
    });
    return this.insideSmoke;
  }

  dispose() {
    for (const m of Object.values(this.ghost ?? {})) {
      this.scene.remove(m);
      m.material.dispose();
    }
    for (const item of this.items.values()) this.remove(item);
    for (const ev of this.events) for (const o of ev.objects) this.scene.remove(o);
    for (const g of Object.values(this.geo)) g.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.soft.dispose();
  }
}
