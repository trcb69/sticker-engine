import React from 'react';
import {Composition, Sequence, AbsoluteFill, Audio, Loop, staticFile } from 'remotion';
import {FPS, SCENES, sceneFrames, TOTAL} from './timeline';
import {Hook} from './scenes/Hook';
import {CurrentDraw} from './scenes/CurrentDraw';
import {Fuser3D} from './scenes/Fuser3D';
import {Runtime} from './scenes/Runtime';
import {Batch} from './scenes/Batch';
import {UpsLife} from './scenes/UpsLife';
import {Replacement} from './scenes/Replacement';
import {Outro} from './scenes/Outro';
import {withFonts} from './components/FontGate';

const C = {Hook, CurrentDraw, Fuser3D, Runtime, Batch, UpsLife, Replacement, Outro};

// Scene start frame by id, for placing sound effects.
const starts: Record<string, number> = {};
{
  let f = 0;
  for (const [id] of SCENES) {
    starts[id] = f;
    f += sceneFrames[id];
  }
}
const at = (id: string, sec: number) => starts[id] + Math.round(sec * FPS);
const BED = 30 * FPS;
const sec = (x: number) => Math.round(x * FPS);

const Sfx: React.FC = () => (
  <>
    <Loop durationInFrames={BED}>
      <Audio src={staticFile('sfx/bed.wav')} volume={0.55} />
    </Loop>
    {SCENES.slice(1).map(([id]) => (
      <Sequence key={id} from={starts[id] - sec(0.13)} durationInFrames={sec(0.5)}>
        <Audio src={staticFile('sfx/whoosh.wav')} volume={0.35} />
      </Sequence>
    ))}
    <Sequence from={at('Hook', 0.15)} durationInFrames={sec(0.17)}><Audio src={staticFile('sfx/click.wav')} volume={0.5} /></Sequence>
    <Sequence from={at('Hook', 0.35)} durationInFrames={sec(0.17)}><Audio src={staticFile('sfx/click.wav')} volume={0.5} /></Sequence>
    <Sequence from={at('Fuser3D', 5.5)} durationInFrames={sec(1.3)}><Audio src={staticFile('sfx/hum.wav')} volume={0.5} /></Sequence>
    <Sequence from={at('Runtime', 11)} durationInFrames={sec(0.7)}><Audio src={staticFile('sfx/alarm.wav')} volume={0.3} /></Sequence>
    <Sequence from={at('Replacement', 0.2)} durationInFrames={sec(1)}><Audio src={staticFile('sfx/ding.wav')} volume={0.4} /></Sequence>
  </>
);

const Main: React.FC = () => {
  let from = 0;
  return (
    <AbsoluteFill style={{background: '#0E1217'}}>
      <Sfx />
      {SCENES.map(([id]) => {
        const Comp = C[id];
        const el = (
          <Sequence key={id} from={from} durationInFrames={sceneFrames[id]} name={id}>
            <Comp />
          </Sequence>
        );
        from += sceneFrames[id];
        return el;
      })}
    </AbsoluteFill>
  );
};

const MainF = withFonts(Main);
const F = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, withFonts(v)])) as typeof C;

export const Root: React.FC = () => (
  <>
    <Composition id="UpsPrinter" component={MainF} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
    {SCENES.map(([id]) => (
      <Composition key={id} id={`S-${id}`} component={F[id]} durationInFrames={sceneFrames[id]} fps={FPS} width={1920} height={1080} />
    ))}
  </>
);
