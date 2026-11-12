/** decodeURIComponent that never throws (bad "%" sequences → raw string). */
export function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
