// The shade over an offer's picture: strongest at the bottom, where the text
// sits, fading upwards so the picture stays visible. opacity is 0-100.
export function overlayGradient(hex, opacity) {
  const alpha = (part) => Math.round((opacity / 100) * part * 255).toString(16).padStart(2, '0');
  return `linear-gradient(to top, ${hex}${alpha(1)}, ${hex}${alpha(0.4)} 55%, ${hex}${alpha(0.07)})`;
}
