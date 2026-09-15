/**
 * The diagnostics test label, kept free of the DOM so it can be tested.
 *
 * A border, the device name and a Code 128 that scans without setting up a
 * whole job, sized for 100 x 25 mm stock with everything 1.5 mm inside the edge.
 * @param {string} deviceName
 * @returns {string}
 */
export function testLabel(deviceName) {
  const name = String(deviceName).slice(0, 28).replace(/[\^~\\]/g, ' ');
  return '^XA\n^PW800\n^LL200\n^LH0,0\n^CI28\n'
    + '^FO12,12^GB775,176,2^FS\n'
    + '^FO30,24^A0N,28,28^FDSticker Engine test label^FS\n'
    + `^FO30,58^A0N,22,22^FD${name}^FS\n`
    + '^BY2,3,60\n'
    + '^FO30,96^BCN,60,Y,N,N^FDTEST12345^FS\n'
    + '^PQ1\n^XZ\n';
}
