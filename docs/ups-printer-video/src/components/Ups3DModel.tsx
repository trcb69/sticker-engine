import React, {useMemo} from 'react';
import * as THREE from 'three';
import {theme} from '../theme';
import {UPS_BLACK, UPS_GLOSS, UPS_LCD, UPS_RIM} from './UpsCutout';

// Low-poly Prolink PRO903ES (W 190 x D 421 x H 318 mm). World units = UpsCutout viewBox units / 100:
// world x = (svgX - 125) / 100, world y = (394 - svgY) / 100. 1 mm = 0.0121 units, so the box is
// 2.3 wide, 3.7 tall (+ feet) and 5.1 deep. Front face is at z = +FRONT.

const W = 2.3;
const H = 3.73;
const D = 5.1;
const FRONT = D / 2;
const BODY_Y = 0.12 + H / 2;
const wx = (sx: number) => (sx - 125) / 100;
const wy = (sy: number) => (394 - sy) / 100;

const canvasTex = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

export const Ups3DModel: React.FC<{charge?: number; label?: string; alarm?: boolean}> = ({
  charge = 1, label = '3 kVA', alarm = false,
}) => {
  const g = useMemo(() => {
    const body = new THREE.BoxGeometry(W, H, D);
    return {
      body,
      edges: new THREE.EdgesGeometry(body),
      bezel: new THREE.BoxGeometry(W + 0.01, 1.41, 0.04),
      panel: new THREE.PlaneGeometry(1.34, 1.3),
      lcdFrame: new THREE.BoxGeometry(1.04, 0.7, 0.04),
      lcd: new THREE.PlaneGeometry(0.94, 0.6),
      button: new THREE.BoxGeometry(0.28, 0.05, 0.035),
      grille: new THREE.PlaneGeometry(2.06, 2.18),
      foot: new THREE.CylinderGeometry(0.15, 0.17, 0.14, 16),
      vent: new THREE.PlaneGeometry(1.3, 0.9),
      screw: (() => {
        const c = new THREE.CylinderGeometry(0.04, 0.04, 0.02, 8);
        c.rotateZ(Math.PI / 2);
        return c;
      })(),
    };
  }, []);

  // front decal: wordmark + tiny button labels on the recessed panel (svg x58..192, y20..150, 4 px / unit)
  const decal = useMemo(() => canvasTex(536, 520, (ctx) => {
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, 536, 520);
    ctx.strokeStyle = '#252a31';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 530, 514);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = `700 52px ${theme.font.display}`;
    ctx.fillText('PROLiNK', (125 - 58) * 4, (116 - 20) * 4);
    ctx.fillStyle = '#d5d9de';
    ctx.font = `400 26px ${theme.font.display}`;
    ['ON/MUTE', 'SELECT', 'OFF/ENTER'].forEach((t, i) => ctx.fillText(t, ([92, 125, 158][i] - 58) * 4, (139 - 20) * 4));
    ['▲', '▼', '↵'].forEach((t, i) => ctx.fillText(t, ([92, 125, 158][i] - 58) * 4, (146 - 20) * 4));
  }), []);

  // LCD: label + battery bar, driven by props (mirrors the flat cut-out)
  const lcdTex = useMemo(() => canvasTex(376, 240, (ctx) => {
    const fg = alarm ? theme.color.ink : '#EAF2FF';
    ctx.fillStyle = alarm ? theme.color.hero : UPS_LCD;
    ctx.fillRect(0, 0, 376, 240);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.font = `700 88px ${theme.font.mono}`;
    ctx.fillText(label, 188, 112);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 8;
    ctx.strokeRect(48, 144, 256, 56);
    ctx.fillRect(304, 160, 16, 24);
    ctx.fillStyle = alarm ? theme.color.ink : charge < 0.25 ? theme.color.hero : fg;
    ctx.fillRect(60, 156, Math.max(0, 232 * charge), 32);
  }), [label, charge, alarm]);

  // grille: 4 columns of horizontal slats (svg x22..228, y158..376 -> 206 x 218 units)
  const grilleTex = useMemo(() => canvasTex(824, 872, (ctx) => {
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, 824, 872);
    for (let col = 0; col < 4; col++) {
      const x0 = col * 206 + 4;
      ctx.fillStyle = '#2c2e31';
      for (let y = 0; y < 872; y += 24) ctx.fillRect(x0, y, 196, 10);
      ctx.fillStyle = '#050505';
      ctx.fillRect(col * 206, 0, 6, 872);
    }
  }), []);

  // perforated side vent (small dots on a grid)
  const ventTex = useMemo(() => canvasTex(260, 180, (ctx) => {
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(0, 0, 260, 180);
    ctx.fillStyle = '#050505';
    for (let y = 10; y < 175; y += 12) for (let x = 10; x < 255; x += 12) {
      ctx.beginPath();
      ctx.arc(x + ((y / 12) % 2 ? 6 : 0), y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }), []);

  const matte = {roughness: 0.85, metalness: 0} as const;
  return (
    <group>
      <ambientLight intensity={1.4} />
      <directionalLight position={[-5, 7, 9]} intensity={2.2} />
      <directionalLight position={[7, 3, 2]} intensity={0.9} />

      {/* matte black steel tower + thin light edge lines */}
      <mesh geometry={g.body} position={[0, BODY_Y, 0]}>
        <meshStandardMaterial color={UPS_BLACK} {...matte} />
      </mesh>
      <lineSegments geometry={g.edges} position={[0, BODY_Y, 0]}>
        <lineBasicMaterial color={UPS_RIM} />
      </lineSegments>

      {/* glossy upper bezel */}
      <mesh geometry={g.bezel} position={[0, wy(79.5), FRONT + 0.015]}>
        <meshStandardMaterial color={UPS_GLOSS} roughness={0.4} metalness={0} />
      </mesh>
      <mesh geometry={g.panel} position={[0, wy(85), FRONT + 0.04]}>
        <meshStandardMaterial map={decal} roughness={0.5} />
      </mesh>
      <mesh geometry={g.lcdFrame} position={[0, wy(64), FRONT + 0.05]}>
        <meshStandardMaterial color="#05070a" roughness={0.4} />
      </mesh>
      <mesh geometry={g.lcd} position={[0, wy(64), FRONT + 0.075]}>
        <meshBasicMaterial map={lcdTex} toneMapped={false} />
      </mesh>
      {[92, 125, 158].map((sx) => (
        <mesh key={sx} geometry={g.button} position={[wx(sx), wy(126.5), FRONT + 0.06]}>
          <meshStandardMaterial color="#F2F2F2" roughness={0.6} />
        </mesh>
      ))}

      {/* grille */}
      <mesh geometry={g.grille} position={[0, wy(267), FRONT + 0.012]}>
        <meshStandardMaterial map={grilleTex} {...matte} />
      </mesh>

      {/* feet */}
      {[-0.85, 0.85].flatMap((x) => [-1.9, 1.9].map((z) => (
        <mesh key={`${x}${z}`} geometry={g.foot} position={[x, 0.07, z]}>
          <meshStandardMaterial color="#0b0b0b" {...matte} />
        </mesh>
      )))}

      {/* +x side: perforated vent patch near the top rear, small screws */}
      <mesh geometry={g.vent} position={[W / 2 + 0.004, 3.2, -1.5]} rotation={[0, Math.PI / 2, 0]}>
        <meshStandardMaterial map={ventTex} {...matte} />
      </mesh>
      {[[3.65, 2.3], [3.65, -2.3], [0.45, 2.3], [0.45, -2.3]].map(([y, z]) => (
        <mesh key={`${y}${z}`} geometry={g.screw} position={[W / 2 + 0.01, y, z]}>
          <meshStandardMaterial color="#555b63" roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
};
