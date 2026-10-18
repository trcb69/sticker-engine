import React, {useLayoutEffect, useMemo} from 'react';
import * as THREE from 'three';
import {useThree} from '@react-three/fiber';
import {useCurrentFrame} from 'remotion';
import {theme} from '../theme';
import {stepped, wobble} from './stop';

// 3D paper-craft version of PrinterCutout. World units: 1 unit = 100 SVG units of the
// cut-out's viewBox, with world y = (370 - svgY) / 100 and world x = (svgX - 250) / 100,
// so a front-on, nearly orthographic camera reproduces the flat card's silhouette.

const P = theme.color.paper;
const I = theme.color.ink;
const PAPER_DARK = '#D9D2C3'; // same darker paper as the cut-out's base
const BODY_D = 3; // depth (z)
const FRONT_Z = BODY_D / 2;

/** Points of the cut-out body trapezoid between world heights y0 and y1. */
const halfW = (y: number) => 2.1 - (0.2 * (y - 0.4)) / 2.2; // 2.1 at y=0.4, 1.9 at y=2.6
const trapezoid = (y0: number, y1: number, dy = 0) => {
  const s = new THREE.Shape();
  s.moveTo(-halfW(y0), y0 + dy);
  s.lineTo(halfW(y0), y0 + dy);
  s.lineTo(halfW(y1), y1 + dy);
  s.lineTo(-halfW(y1), y1 + dy);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {depth: BODY_D, bevelEnabled: false});
  g.translate(0, 0, -BODY_D / 2);
  return g;
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

/** A paper solid: surface + ink crease lines + (optional) thick ink silhouette. */
const Inked: React.FC<{
  geometry: THREE.BufferGeometry;
  color?: string;
  opacity?: number;
  hull?: number;
  edgeAngle?: number;
  position?: [number, number, number];
}> = ({geometry, color = P, opacity = 1, hull = 0, edgeAngle = 20, position}) => {
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
        <lineBasicMaterial color={I} transparent opacity={Math.max(opacity, 0.85)} />
      </lineSegments>
      {hullG && hullOp > 0.01 ? (
        <mesh geometry={hullG}>
          <meshBasicMaterial color={I} side={THREE.BackSide} transparent opacity={hullOp} depthWrite={hullOp > 0.98} />
        </mesh>
      ) : null}
    </group>
  );
};

const Edges: React.FC<{geometry: THREE.BufferGeometry; angle: number; opacity: number; position: [number, number, number]}> = ({
  geometry, angle, opacity, position,
}) => {
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, angle), [geometry, angle]);
  return (
    <lineSegments geometry={edges} position={position}>
      <lineBasicMaterial color={I} transparent opacity={opacity} />
    </lineSegments>
  );
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
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    gl.render(scene, camera);
  });
  return null;
};

export type ModelState = {
  bodyOpacity: number; // 1 = solid paper, ~0.2 = see-through
  lid: number; // 0 closed .. 1 lifted (caller steps it on threes)
  heat: number; // 0..1
  paperRun: number; // 0..1 visibility of sheets travelling through the fuser
};

const NIP_Y = 1.15;

export const PrinterModel: React.FC<{state: ModelState}> = ({state}) => {
  const frame = useCurrentFrame();
  const {bodyOpacity, lid, heat, paperRun} = state;

  const g = useMemo(() => {
    const base = new THREE.BoxGeometry(4.2, 0.4, BODY_D + 0.2);
    base.translate(0, 0.2, 0);
    // lid geometry is built around its hinge (back top edge at y=2, z=-1.5)
    const lidG = trapezoid(2.0, 2.6, -2.0);
    lidG.translate(0, 0, FRONT_Z);
    return {
      base,
      body: trapezoid(0.4, 2.0),
      lid: lidG,
      slot: new THREE.BoxGeometry(2.4, 0.18, 0.04),
      window: new THREE.BoxGeometry(2.0, 0.7, 0.04),
      glow: (() => {
        const c = new THREE.CapsuleGeometry(0.2, 1.3, 4, 12);
        c.rotateZ(Math.PI / 2);
        c.scale(1, 1, 0.12);
        return c;
      })(),
      panel: new THREE.BoxGeometry(0.6, 0.24, 0.06),
      led: (() => {
        const c = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16);
        c.rotateX(Math.PI / 2);
        return c;
      })(),
      paperTop: new THREE.BoxGeometry(2.0, 0.8, 0.03),
      heatRoller: (() => {
        const c = new THREE.CylinderGeometry(0.3, 0.3, 3.3, 20, 1, true);
        c.rotateZ(Math.PI / 2);
        return c;
      })(),
      core: (() => {
        const c = new THREE.CylinderGeometry(0.075, 0.075, 3.5, 10);
        c.rotateZ(Math.PI / 2);
        return c;
      })(),
      pressRoller: (() => {
        const c = new THREE.CylinderGeometry(0.26, 0.26, 3.2, 20);
        c.rotateZ(Math.PI / 2);
        return c;
      })(),
      plate: new THREE.BoxGeometry(0.1, 1.15, 1.0),
      sheet: new THREE.BoxGeometry(2.0, 0.012, 1.3),
    };
  }, []);

  // "printed" sheet texture: a few lines of grey toner on white
  const printedTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(28, 20, 120, 14);
    for (let i = 0; i < 6; i++) ctx.fillRect(28, 50 + i * 16, 200 - ((i * 37) % 70), 6);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  const hero = theme.color.hero;
  const detailOp = THREE.MathUtils.clamp((bodyOpacity - 0.2) / 0.8, 0, 1);
  const lidW = wobble(frame, 71, lid > 0 && lid < 1 ? 1 : 0.4);
  const insideOp = 1 - detailOp; // fuser parts only matter once the body is see-through

  // sheets advance on threes, front-to-back is -z → +z through the nip at z = 0
  const sf = stepped(frame, 3);
  const span = 3.4;
  const sheets = [0, 1, 2].map((i) => {
    const z = -1.7 + ((sf * 0.022 + i * (span / 3)) % span);
    const edgeFade = THREE.MathUtils.clamp(Math.min(z + 1.7, 1.7 - z) / 0.35, 0, 1);
    return {z, op: edgeFade * paperRun, printed: z > 0.05};
  });

  return (
    <group>
      <ambientLight intensity={1.1} />
      <directionalLight position={[-4, 7, 9]} intensity={2.0} />
      <directionalLight position={[6, 3, -2]} intensity={0.6} />
      <pointLight position={[0, 1.45, 0.9]} color={hero} intensity={heat * 6} distance={0} decay={2} />

      <Inked geometry={g.base} color={PAPER_DARK} hull={0.035} opacity={Math.max(bodyOpacity, 0.25)} />
      <Inked geometry={g.body} hull={0.035} opacity={bodyOpacity} />

      {/* front face details on the lower body */}
      <mesh geometry={g.window} position={[0, 1.45, FRONT_Z + 0.02]} renderOrder={5}>
        <meshBasicMaterial color={I} transparent opacity={detailOp} depthWrite={false} />
      </mesh>
      <mesh geometry={g.glow} position={[0, 1.45, FRONT_Z + 0.05]} renderOrder={6}>
        <meshStandardMaterial color={'#2a2f36'} emissive={hero} emissiveIntensity={0.15 + heat * 0.85}
          transparent opacity={detailOp * (0.35 + heat * 0.65)} depthWrite={false} />
      </mesh>
      <Inked geometry={g.panel} color={PAPER_DARK} opacity={Math.max(detailOp, 0.15)} position={[1.5, 0.78, FRONT_Z + 0.03]} />
      <mesh geometry={g.led} position={[-1.6, 0.78, FRONT_Z + 0.03]} renderOrder={5}>
        <meshBasicMaterial color={heat > 0.05 ? hero : theme.color.ok} transparent opacity={detailOp} depthWrite={false} />
      </mesh>

      {/* lid: hinged at the back top edge, lifts on threes */}
      <group position={[0, 2.0 + lid * 0.6, -FRONT_Z]} rotation={[-lid * 0.38 + lidW.r * 0.004, lidW.x * 0.002, 0]}>
        <Inked geometry={g.lid} hull={0.035} opacity={Math.max(bodyOpacity, lid > 0.5 ? 0.3 : 0)} />
        <mesh geometry={g.slot} position={[0, 0.31, BODY_D + 0.02]} renderOrder={5}>
          <meshBasicMaterial color={I} transparent opacity={Math.max(detailOp, lid > 0.5 ? 0.55 : 0)} />
        </mesh>
        <Inked geometry={g.paperTop} color={'#ffffff'} position={[0, 0.7, FRONT_Z]} opacity={Math.max(bodyOpacity, 0.6)} />
      </group>

      {/* fuser unit */}
      <group visible={insideOp > 0.02}>
        <mesh geometry={g.core} position={[0, NIP_Y + 0.3, 0]}>
          <meshStandardMaterial color={'#2a2f36'} emissive={hero} emissiveIntensity={0.05 + heat * 2.2} roughness={0.6} />
        </mesh>
        <mesh geometry={g.heatRoller} position={[0, NIP_Y + 0.3, 0]} renderOrder={3}>
          <meshStandardMaterial color={'#4a4f57'} emissive={hero} emissiveIntensity={heat * 0.7} roughness={0.5}
            transparent opacity={insideOp * 0.55} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <Edges geometry={g.heatRoller} angle={30} opacity={insideOp} position={[0, NIP_Y + 0.3, 0]} />
        <Inked geometry={g.pressRoller} color={'#3a3f46'} opacity={insideOp} edgeAngle={30} position={[0, NIP_Y - 0.26, 0]} />
        {[-1.75, 1.75].map((x) => (
          <Inked key={x} geometry={g.plate} color={PAPER_DARK} opacity={insideOp} position={[x, NIP_Y + 0.05, 0]} />
        ))}
        {sheets.map((s, i) => (
          <mesh key={i} geometry={g.sheet} position={[0, NIP_Y, s.z]} visible={s.op > 0.01}>
            <meshStandardMaterial key={s.printed ? 'printed' : 'blank'} color={'#ffffff'} map={s.printed ? printedTex : null} roughness={0.95}
              transparent opacity={s.op} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
};
