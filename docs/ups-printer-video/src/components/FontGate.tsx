import React, {useEffect, useState} from 'react';
import {continueRender, delayRender} from 'remotion';

/** Holds the render until both local fonts are loaded (gives up after 8 s). */
export const FontGate: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [handle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => {
    let done = false;
    const release = () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
    Promise.all([
      document.fonts.load("700 40px 'Space Grotesk'"),
      document.fonts.load("400 40px 'JetBrains Mono'"),
    ]).then(release, release);
    const t = setTimeout(release, 8000);
    return () => clearTimeout(t);
  }, [handle]);
  return <>{children}</>;
};

export const withFonts = <P extends object>(C: React.FC<P>): React.FC<P> => {
  const Wrapped: React.FC<P> = (props) => (
    <FontGate>
      <C {...props} />
    </FontGate>
  );
  return Wrapped;
};
