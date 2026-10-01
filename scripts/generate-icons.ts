// Render the raster icons Google, iOS and Android need from the Chicago Pipeline pin mark.
// Usage: pnpm exec tsx scripts/generate-icons.ts   (outputs are committed)
// public/favicon.svg (vector, light/dark aware) is maintained by hand from src/assets/brand/favicon-source.svg.
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

// Light ground behind the mark so the ink outline stays visible on dark tabs and home screens.
const icon = readFileSync("src/assets/brand/icon.svg", "utf8");

function render(source: string, size: number): Buffer {
  return new Resvg(source, { fitTo: { mode: "width", value: size } }).render().asPng();
}

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

writeFileSync("public/favicon-32x32.png", render(icon, 32));
writeFileSync("public/favicon.ico", ico([16, 32, 48].map((size) => ({ size, data: render(icon, size) }))));
writeFileSync("public/apple-touch-icon.png", render(icon, 180));
writeFileSync("public/icon-192.png", render(icon, 192));
writeFileSync("public/icon-512.png", render(icon, 512));
console.log("Wrote favicon.ico, favicon-32x32.png, apple-touch-icon.png, icon-192.png, icon-512.png");
