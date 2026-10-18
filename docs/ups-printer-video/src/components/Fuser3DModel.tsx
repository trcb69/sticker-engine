import React, {useLayoutEffect, useMemo} from 'react';
import * as THREE from 'three';
import {useThree} from '@react-three/fiber';
import {useCurrentFrame} from 'remotion';
import {theme} from '../theme';
import {stepped, wobble} from './stop';
import {CUT_K, PANEL_PARTS, RICOH} from './PrinterCutout';

// 3D paper-craft Ricoh M 2310N, built from the same millimetre spec as PrinterCutout.
// World units: 1 unit = 100 cut-out viewBox units. The model is built in mm inside one group:
//   world x = (x_mm - W/2) * K,  world y = y_mm * K,  world z = (z_mm + D/2) * K
// where z_mm = 0 is the front face and z_mm = -565 the back. A front-on, nearly orthographic
// camera therefore reproduces the flat card exactly.

const R = RICOH;
const C = R.col;
const I = theme.color.ink;
export const K3 = CUT_K / 100; // world units per mm
export const FRONT_Z = (R.D / 2) * K3; // world z of the front face
/** World position of a point given in model mm. */
export const mmToWorld = (x: number, y: number, z: number): [number, number, number] => [
  (x - R.W / 2) * K3, y * K3, (z + R.D / 2) * K3,
];

// fuser: across the body, behind the output bay; paper exits forward into the bay
const NIP = {y: 300, z: -425};
const FUSER = {x0: 22, x1: 470};
export const FUSER_FOCUS = mmToWorld((FUSER.x0 + FUSER.x1) / 2, NIP.y + 10, NIP.z);

// ── geometry helpers (mm)
const roundRectShape = (x0: number, y0: number, x1: number, y1: number, r: number) => {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
};

/** Box with rounded VERTICAL edges: plan x0..x1 × z0..z1 (z negative = back), height y0..y1. */
const roundedBlock = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, r: number) => {
  const g = new THREE.ExtrudeGeometry(roundRectShape(x0, -z1, x1, -z0, r), {
    depth: y1 - y0, bevelEnabled: false, curveSegments: 3,
  });
  g.rotateX(-Math.PI / 2); // shape y → -z, extrusion → +y
  g.translate(0, y0, 0);
  return g;
};

/** Front-elevation outline extruded backwards from zFront. */
const extrudeFront = (shape: THREE.Shape, zFront: number, depth: number) => {
  const g = new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled: false, curveSegments: 4});
  g.translate(0, 0, zFront - depth);
  return g;
};

const poly = (pts: readonly (readonly [number, number])[]) => {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
};

/** Inverted-hull copy: slightly inflated around its own centre, drawn back-face only in ink. */
const hullOf = (g: THREE.BufferGeometry, t: number) => {
  const h = g.clone();
  h.computeBoundingBox();
  const b = h.boundingBox!;
  const c = b.getCenter(new THREE.Vector3());
  const sz = b.getSize(new THREE.Vector3());
  h.translate(-c.x, -c.y, -c.z);
  h.scale(1 + (2 * t) / sz.x, 1 + (2 * t) / sz.y, 1 + (2 * t) / sz.z);
  h.translate(c.x, c.y, c.z);
  return h;
};

/** A paper solid: matte surface + ink crease lines + optional thick ink silhouette (inverted hull). */
const Inked: React.FC<{
  geometry: THREE.BufferGeometry;
  color: string;
  opacity?: number;
  hull?: number;
  edgeAngle?: number;
  position?: [number, number, number];
}> = ({geometry, color, opacity = 1, hull = 0, edgeAngle = 35, position}) => {
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, edgeAngle), [geometry, edgeAngle]);
  const hullG = useMemo(() => (hull ? hullOf(geometry, hull) : null), [geometry, hull]);
  const hullOp = THREE.MathUtils.clamp((opacity - 0.5) / 0.5, 0, 1);
  return (
    <group position={position}>
      <mesh geometry={geometry} renderOrder={1}>
        <meshStandardMaterial color={color} roughness={0.9} metalness={0} transparent opacity={opacity}
          depthWrite={opacity > 0.98} />
      </mesh>
      <lineSegments geometry={edges} renderOrder={2}>
        <lineBasicMaterial color={I} transparent opacity={Math.max(opacity, 0.8)} />
      </lineSegments>
      {hullG && hullOp > 0.01 ? (
        <mesh geometry={hullG}>
          <meshBasicMaterial color={I} side={THREE.BackSide} transparent opacity={hullOp} depthWrite={hullOp > 0.98} />
        </mesh>
      ) : null}
    </group>
  );
};

const Edges: React.FC<{geometry: THREE.BufferGeometry; angle: number; opacity: number; position?: [number, number, number]}> = ({
  geometry, angle, opacity, position,
}) => {
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, angle), [geometry, angle]);
  return (
    <lineSegments geometry={edges} position={position} renderOrder={6}>
      <lineBasicMaterial color={I} transparent opacity={opacity} />
    </lineSegments>
  );
};

/** Flat decal (badge, panel, A4 plate) drawn on a canvas. */
const Decal: React.FC<{tex: THREE.Texture; w: number; h: number; position: [number, number, number]; opacity: number; order?: number}> = ({
  tex, w, h, position, opacity, order = 5,
}) => (
  <mesh position={position} renderOrder={order}>
    <planeGeometry args={[w, h]} />
    <meshBasicMaterial map={tex} transparent opacity={opacity} depthWrite={false} />
  </mesh>
);

const makeTexture = (wmm: number, hmm: number, pxPerMm: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
  const c = document.createElement('canvas');
  c.width = Math.round(wmm * pxPerMm);
  c.height = Math.round(hmm * pxPerMm);
  const ctx = c.getContext('2d')!;
  ctx.scale(pxPerMm, pxPerMm);
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
};

export type CamState = {
  az: number; // radians, camera swings round to +x
  el: number; // radians
  dist: number;
  fov: number; // degrees
  focus: [number, number, number];
  shift: number; // world units: moves the subject right on screen
};

export const CameraRig: React.FC<{cam: CamState}> = ({cam}) => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const {az, el, dist, fov, focus, shift} = cam;
  const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
  const target = new THREE.Vector3(...focus).addScaledVector(right, -shift);
  camera.position.set(
    target.x + dist * Math.sin(az) * Math.cos(el),
    target.y + dist * Math.sin(el),
    target.z + dist * Math.cos(az) * Math.cos(el),
  );
  camera.fov = fov;
  camera.near = 0.1;
  camera.far = 400;
  camera.updateProjectionMatrix();
  camera.lookAt(target);
  // The canvas runs with frameloop="never": draw exactly once per video frame, synchronously,
  // after this commit has applied every prop. Mount this rig as the LAST child of the canvas.
  useLayoutEffect(() => {
    gl.render(scene, camera);
  });
  return null;
};

export type ModelState = {
  bodyOpacity: number; // 1 = solid, ~0.12 = see-through
  lid: number; // 0 closed .. 1 scanner + ARDF lifted (caller steps it on threes)
  heat: number; // 0..1
  paperRun: number; // 0..1 visibility of sheets travelling through the fuser
};

const PANEL_TILT = 0.19; // rad: panel face leans back ~11°

export const PrinterModel: React.FC<{state: ModelState}> = ({state}) => {
  const frame = useCurrentFrame();
  const {bodyOpacity, lid, heat, paperRun} = state;
  const hero = theme.color.hero;

  const g = useMemo(() => {
    const D = R.D;
    const bd = R.bayDepth;
    const f = R.fillet;
    // concave fillet where the grey body steps up beside the bay (front elevation), run through the bay depth
    const fil = new THREE.Shape();
    fil.moveTo(R.bayRight, R.bayFloor + f);
    fil.lineTo(R.bayRight, R.bayFloor);
    fil.lineTo(R.bayRight - f, R.bayFloor);
    fil.quadraticCurveTo(R.bayRight, R.bayFloor, R.bayRight, R.bayFloor + f);
    // door outline (same path as the cut-out)
    const d = R.door;
    const door = new THREE.Shape();
    door.moveTo(d.x0, d.y0);
    door.lineTo(d.x1 - d.r, d.y0);
    door.quadraticCurveTo(d.x1, d.y0, d.x1, d.y0 + d.r);
    door.lineTo(d.x1, d.y1 - d.r);
    door.quadraticCurveTo(d.x1, d.y1, d.x1 - d.r, d.y1);
    door.lineTo(R.bayRight + 18, d.y1);
    door.quadraticCurveTo(R.bayRight, d.y1, R.bayRight, d.y1 - 18);
    door.lineTo(R.bayRight, R.bayFloor + f);
    door.quadraticCurveTo(R.bayRight, R.bayFloor, R.bayRight - f, R.bayFloor);
    door.lineTo(d.x0, R.bayFloor);
    door.closePath();
    const n = R.notch;
    const notch = new THREE.Shape();
    notch.moveTo(n.x0, 0);
    notch.lineTo(n.x0, n.h - 8);
    notch.quadraticCurveTo(n.x0, n.h, n.x0 + 8, n.h);
    notch.lineTo(n.x1 - 8, n.h);
    notch.quadraticCurveTo(n.x1, n.h, n.x1, n.h - 8);
    notch.lineTo(n.x1, 0);
    notch.closePath();
    const a = R.ardf;
    const p = R.panel;
    // panel console wedge: side profile (u = outward, v = height), extruded across the panel width
    const lean = (p.y1 - p.y0) * Math.tan(PANEL_TILT);
    const wedge = new THREE.Shape();
    wedge.moveTo(0, p.y0);
    wedge.lineTo(lean, p.y0);
    wedge.lineTo(0, p.y1);
    wedge.closePath();
    const wedgeG = new THREE.ExtrudeGeometry(wedge, {depth: p.x1 - p.x0, bevelEnabled: false});
    wedgeG.rotateY(-Math.PI / 2); // u → +z, extrusion → -x
    wedgeG.translate(p.x1, 0, 4);
    const roller = (r: number) => {
      const c = new THREE.CylinderGeometry(r, r, FUSER.x1 - FUSER.x0, 20, 1, true);
      c.rotateZ(Math.PI / 2);
      return c;
    };
    return {
      cassette: roundedBlock(0, R.W, -D, 0, 0, R.cassetteTop, 16),
      notch: new THREE.ShapeGeometry(notch),
      lower: roundedBlock(0, R.W, -D, 0, R.cassetteTop + 0.5, R.bayFloor, 16),
      rightUpper: roundedBlock(R.bayRight, R.W, -D, 0, R.bayFloor, R.deckBottom, 16),
      fillet: extrudeFront(fil, 0, bd),
      back: roundedBlock(0, R.bayRight + 10, -D, -bd, R.bayFloor, R.deckBottom, 16),
      leftWall: new THREE.BoxGeometry(R.bayLeftWall, R.deckBottom - R.bayFloor, bd),
      trayFloor: new THREE.BoxGeometry(R.bayRight - 4, R.trayTop - R.bayFloor + 3, bd),
      glow: new THREE.PlaneGeometry(R.bayRight - R.bayLeftWall, R.deckBottom - R.trayTop),
      door: new THREE.ShapeGeometry(door, 6),
      deck: roundedBlock(3, 572, -D + 5, 4, R.deckBottom, R.deckTop, 10),
      wedge: wedgeG,
      scanner: roundedBlock(6, 560, -D + 10, -2, R.deckTop - 2, R.scanTop, 10),
      ardf: extrudeFront(poly([[a.x0, R.scanTop], [a.x1, R.scanTop], [a.x1, a.slopeY], [a.slopeX, R.ardfTop], [a.x0, R.ardfTop]]), -6, 470),
      feeder: extrudeFront(roundRectShape(R.feeder.x0, R.feeder.y0, R.feeder.x1, R.feeder.y1, 8), -40, 300),
      inTray: extrudeFront(poly(R.inTray), -70, 270),
      core: (() => {
        const c = new THREE.CylinderGeometry(7, 7, FUSER.x1 - FUSER.x0 + 24, 10);
        c.rotateZ(Math.PI / 2);
        return c;
      })(),
      heatRoller: roller(22),
      pressRoller: roller(20),
      plate: new THREE.BoxGeometry(10, 95, 90),
      sheet: new THREE.BoxGeometry(250, 1.2, 200),
      seam: new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(R.door.x1, R.door.y0, 1.5), new THREE.Vector3(R.door.x1, R.cassetteTop, 1.5),
      ]),
    };
  }, []);

  const tex = useMemo(() => {
    const hero = theme.color.hero;
    const p = R.panel;
    const panel = makeTexture(p.x1 - p.x0, p.y1 - p.y0, 8, (ctx) => {
      ctx.fillStyle = C.black;
      ctx.fillRect(0, 0, p.x1 - p.x0, p.y1 - p.y0);
      for (const k of PANEL_PARTS) {
        ctx.fillStyle = k.fill;
        rr(ctx, k.x0 - p.x0, p.y1 - k.y1, k.x1 - k.x0, k.y1 - k.y0, k.r ?? 0);
      }
    });
    const b = R.badge;
    const badge = makeTexture(b.x1 - b.x0, b.y1 - b.y0, 12, (ctx) => {
      const w = b.x1 - b.x0;
      ctx.fillStyle = C.word;
      ctx.textAlign = 'center';
      ctx.font = `700 17px ${theme.font.display}`;
      ctx.fillText('RICOH', w / 2, b.y1 - 205);
      ctx.font = `500 10px ${theme.font.display}`;
      ctx.fillText('M 2310N', w / 2, b.y1 - 187);
      ctx.fillStyle = '#A9AAA8';
      ctx.fillRect(6, b.y1 - 201 - 0.6, w - 12, 1.2);
    });
    const a4 = R.a4;
    const plate = makeTexture(a4.x1 - a4.x0, a4.y1 - a4.y0, 12, (ctx) => {
      const w = a4.x1 - a4.x0, h = a4.y1 - a4.y0;
      ctx.fillStyle = '#8E8F8D';
      rr(ctx, 0, 0, w, h, 4);
      ctx.fillStyle = C.white;
      rr(ctx, 1.2, 1.2, w - 2.4, h - 2.4, 3.2);
      ctx.fillStyle = C.word;
      ctx.font = `500 16px ${theme.font.display}`;
      ctx.fillText('A4', 8, a4.y1 - 42);
      ctx.strokeStyle = C.word;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(w - 18, a4.y1 - 45); ctx.lineTo(w - 18, a4.y1 - 57); ctx.lineTo(w - 9, a4.y1 - 57);
      ctx.lineTo(w - 9, a4.y1 - 49); ctx.lineTo(w - 13, a4.y1 - 45); ctx.closePath();
      ctx.stroke();
    });
    // printed-sheet look for paper that has passed the fuser
    const printed = makeTexture(250, 200, 2, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 250, 200);
      ctx.fillStyle = '#3a3f46';
      ctx.fillRect(25, 22, 110, 12);
      for (let i = 0; i < 7; i++) ctx.fillRect(25, 50 + i * 18, 200 - ((i * 37) % 70), 6);
    });
    // soft heat glow for the back of the output bay (same falloff as the cut-out's radial gradient)
    const glow = makeTexture(100, 60, 4, (ctx) => {
      ctx.save();
      ctx.translate(55, 34);
      ctx.scale(1, 0.55);
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 50);
      gr.addColorStop(0, hero);
      gr.addColorStop(0.5, hero + '99');
      gr.addColorStop(1, hero + '00');
      ctx.fillStyle = gr;
      ctx.fillRect(-60, -70, 120, 140);
      ctx.restore();
    });
    return {panel, badge, plate, printed, glow};
  }, []);

  const op = bodyOpacity;
  const detailOp = THREE.MathUtils.clamp((op - 0.2) / 0.8, 0, 1);
  const insideOp = 1 - detailOp;
  const lidW = wobble(frame, 71, lid > 0 && lid < 1 ? 1 : 0.4);
  const lidOp = Math.max(op, lid > 0.5 ? 0.3 : 0);
  const panelOp = Math.max(detailOp, lid > 0.5 ? 0.3 : 0);
  const p = R.panel;
  const panelH = (p.y1 - p.y0) / Math.cos(PANEL_TILT);
  const lean = (p.y1 - p.y0) * Math.tan(PANEL_TILT);

  // sheets advance on threes, back → front through the nip and out into the bay
  const sf = stepped(frame, 3);
  const zBack = -R.D + 20, zFront = -30, span = zFront - zBack;
  const sheets = [0, 1, 2].map((i) => {
    const z = zBack + ((sf * 3.4 + i * (span / 3)) % span);
    const edgeFade = THREE.MathUtils.clamp(Math.min(z - zBack, zFront - z) / 60, 0, 1);
    return {z, op: edgeFade * paperRun, printed: z > NIP.z + 40};
  });

  const fx = (FUSER.x0 + FUSER.x1) / 2;
  const glowWorld = mmToWorld(fx - 60, NIP.y + 25, NIP.z + 90);

  return (
    <group>
      <ambientLight intensity={1.15} />
      <directionalLight position={[-4, 7, 9]} intensity={1.9} />
      <directionalLight position={[6, 3, -2]} intensity={0.6} />
      <pointLight position={glowWorld} color={hero} intensity={heat * 5} distance={0} decay={2} />

      <group scale={K3} position={[(-R.W / 2) * K3, 0, (R.D / 2) * K3]}>
        {/* ── body */}
        <Inked geometry={g.cassette} color={C.body} hull={5} opacity={Math.max(op, 0.2)} />
        <mesh geometry={g.notch} position={[0, 0, 1]} renderOrder={5}>
          <meshBasicMaterial color={C.notch} transparent opacity={detailOp} depthWrite={false} />
        </mesh>
        <Edges geometry={g.notch} angle={10} opacity={Math.max(detailOp, 0.2)} position={[0, 0, 1]} />
        <Decal tex={tex.plate} w={R.a4.x1 - R.a4.x0} h={R.a4.y1 - R.a4.y0}
          position={[(R.a4.x0 + R.a4.x1) / 2, (R.a4.y0 + R.a4.y1) / 2, 1.2]} opacity={detailOp} />
        <Inked geometry={g.lower} color={C.body} hull={5} opacity={op} />
        <Inked geometry={g.rightUpper} color={C.body} hull={5} opacity={op} />
        <Inked geometry={g.fillet} color={C.body} opacity={op} position={[0, 0, 0.5]} />
        <Inked geometry={g.back} color={C.body} opacity={op} />
        <Inked geometry={g.leftWall} color={C.black} opacity={op}
          position={[R.bayLeftWall / 2, (R.bayFloor + R.deckBottom) / 2, -R.bayDepth / 2]} />
        <Inked geometry={g.trayFloor} color={C.black} opacity={Math.max(op, 0.35)}
          position={[(R.bayRight + 4) / 2, (R.bayFloor - 3 + R.trayTop) / 2, -R.bayDepth / 2]} />
        {/* back wall of the bay: dark, glows with the fuser's heat */}
        <mesh geometry={g.glow} position={[(R.bayLeftWall + R.bayRight) / 2, (R.trayTop + R.deckBottom) / 2, -R.bayDepth + 1]} renderOrder={4}>
          <meshBasicMaterial color={C.cavity} transparent opacity={op} depthWrite={false} />
        </mesh>
        <mesh geometry={g.glow} position={[(R.bayLeftWall + R.bayRight) / 2, (R.trayTop + R.deckBottom) / 2, -R.bayDepth + 3]}
          scale={[1.15, 1.6, 1]} renderOrder={5}>
          <meshBasicMaterial map={tex.glow} transparent opacity={heat * 0.95} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh geometry={g.door} position={[0, 0, 1]} renderOrder={5}>
          <meshStandardMaterial color={C.door} roughness={0.9} transparent opacity={detailOp} depthWrite={false} />
        </mesh>
        <Edges geometry={g.door} angle={10} opacity={Math.max(detailOp, 0.2)} position={[0, 0, 1.2]} />
        <lineSegments geometry={g.seam} renderOrder={6}>
          <lineBasicMaterial color={I} transparent opacity={Math.max(detailOp, 0.2)} />
        </lineSegments>
        <Decal tex={tex.badge} w={R.badge.x1 - R.badge.x0} h={R.badge.y1 - R.badge.y0}
          position={[(R.badge.x0 + R.badge.x1) / 2, (R.badge.y0 + R.badge.y1) / 2, 1.6]} opacity={detailOp} order={6} />

        {/* ── fuser: heated roller over pressure roller, paper passing through the nip */}
        <group visible={insideOp > 0.02}>
          <mesh geometry={g.core} position={[fx, NIP.y + 22, NIP.z]}>
            <meshStandardMaterial color={'#2a2f36'} emissive={hero} emissiveIntensity={0.05 + heat * 2.2} roughness={0.6} />
          </mesh>
          <mesh geometry={g.heatRoller} position={[fx, NIP.y + 22, NIP.z]} renderOrder={3}>
            <meshStandardMaterial color={'#4a4f57'} emissive={hero} emissiveIntensity={heat * 0.7} roughness={0.5}
              transparent opacity={insideOp * 0.55} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <Edges geometry={g.heatRoller} angle={30} opacity={insideOp} position={[fx, NIP.y + 22, NIP.z]} />
          <Inked geometry={g.pressRoller} color={'#3a3f46'} opacity={insideOp} edgeAngle={30} position={[fx, NIP.y - 20, NIP.z]} />
          {[FUSER.x0 - 8, FUSER.x1 + 8].map((x) => (
            <Inked key={x} geometry={g.plate} color={C.door} opacity={insideOp} position={[x, NIP.y + 2, NIP.z]} />
          ))}
          {sheets.map((s, i) => (
            <mesh key={i} geometry={g.sheet} position={[160, NIP.y, s.z]} visible={s.op > 0.01}>
              <meshStandardMaterial key={s.printed ? 'printed' : 'blank'} color={'#ffffff'} map={s.printed ? tex.printed : null}
                roughness={0.95} transparent opacity={s.op} depthWrite={false} />
            </mesh>
          ))}
        </group>

        {/* ── hinged top: scanner deck + control panel + platen + ARDF; lifts on threes */}
        <group position={[0, R.deckBottom + lid * 70, -R.D]} rotation={[-lid * 0.33 + lidW.r * 0.004, lidW.x * 0.002, 0]}>
          <group position={[0, -R.deckBottom, R.D]}>
            <Inked geometry={g.deck} color={C.black} hull={5} opacity={lidOp} />
            <Inked geometry={g.wedge} color={C.black} opacity={lidOp} edgeAngle={60} />
            <group position={[(p.x0 + p.x1) / 2, p.y0, 4 + lean]} rotation={[-PANEL_TILT, 0, 0]}>
              <Decal tex={tex.panel} w={p.x1 - p.x0} h={panelH} position={[0, panelH / 2, 0.6]} opacity={panelOp} />
              <mesh position={[R.led.x - (p.x0 + p.x1) / 2, (R.led.y - p.y0) / Math.cos(PANEL_TILT), 1.2]} renderOrder={7}>
                <circleGeometry args={[R.led.r, 16]} />
                <meshBasicMaterial color={heat > 0.05 ? hero : C.key} transparent opacity={panelOp} depthWrite={false} />
              </mesh>
            </group>
            <Inked geometry={g.scanner} color={C.white} hull={5} opacity={lidOp} />
            <Inked geometry={g.feeder} color={C.black} opacity={lidOp} />
            <Inked geometry={g.inTray} color={C.black} opacity={lidOp} edgeAngle={40} />
            <Inked geometry={g.ardf} color={C.white} hull={5} opacity={lidOp} />
          </group>
        </group>
      </group>
    </group>
  );
};
