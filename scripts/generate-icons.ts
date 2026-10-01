// One-time: render public/favicon.svg into the raster icons Google, iOS and Android need.
// Usage: pnpm exec tsx scripts/generate-icons.ts   (outputs are committed)
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const svg = readFileSync("public/favicon.svg", "utf8");

function render(source: string, size: number): Buffer {
  return new Resvg(source, { fitTo: { mode: "width", value: size }, font: { loadSystemFonts: true } }).render().asPng();
}

// Home-screen icons: full-bleed square (iOS/Android apply their own corner mask).
const square = svg.replace(/rx="\d+"/, 'rx="0"');

// ICO container holding PNG images (supported by every current browser and by Google).
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size, e);
    header.writeUInt8(size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

writeFileSync("public/favicon-32x32.png", render(svg, 32));
writeFileSync("public/favicon.ico", ico([16, 32, 48].map((size) => ({ size, data: render(svg, size) }))));
writeFileSync("public/apple-touch-icon.png", render(square, 180));
writeFileSync("public/icon-192.png", render(square, 192));
writeFileSync("public/icon-512.png", render(square, 512));
console.log("Wrote favicon.ico, favicon-32x32.png, apple-touch-icon.png, icon-192.png, icon-512.png");
