/** SM83 BCD arithmetic as the Legend I money and price routines do it (add/adc/sub/sbc + daa). */

/** add/adc a, b then daa: [result, carry]. */
export function adcDaa(a: number, b: number, cin: number): [number, number] {
  const h = ((a & 0x0f) + (b & 0x0f) + cin) > 0x0f;
  let r = a + b + cin;
  let c = r > 0xff;
  r &= 0xff;
  if (c || r > 0x99) { r += 0x60; c = true; }
  if (h || (r & 0x0f) > 9) r += 6;
  return [r & 0xff, c ? 1 : 0];
}

/** sub/sbc a, b then daa: [result, carry (borrow)]. */
export function sbcDaa(a: number, b: number, cin: number): [number, number] {
  const h = (a & 0x0f) - (b & 0x0f) - cin < 0;
  let r = a - b - cin;
  const c = r < 0;
  r &= 0xff;
  if (c) r -= 0x60;
  if (h) r -= 6;
  return [r & 0xff, c ? 1 : 0];
}
