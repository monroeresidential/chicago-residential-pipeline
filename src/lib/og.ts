import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori, { type SatoriOptions } from "satori";
import sharp from "sharp";
import { displayName, formatMoney, formatUnits } from "./format";
import { STATUS_LABELS, type Project } from "./schema";
import { totals } from "./stats";

export interface OgContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** JPEG/PNG path relative to the project root, drawn full-bleed under a navy gradient. */
  background?: string;
  caption?: string;
}

export const SITE_NAME = "Chicago Residential Pipeline";

export function projectOgContent(p: Project): OgContent {
  return {
    eyebrow: p.confidence === "reported" ? `${SITE_NAME} · Reported` : SITE_NAME,
    title: displayName(p),
    subtitle: [
      p.units === null ? null : `${formatUnits(p.units)} units`,
      p.tpc_musd === null ? null : formatMoney(p.tpc_musd),
      STATUS_LABELS[p.status],
    ].filter(Boolean).join(" · "),
  };
}

export function siteOgContent(projects: readonly Project[]): OgContent {
  const t = totals(projects);
  return {
    eyebrow: "3F Construction",
    title: SITE_NAME,
    subtitle: `${t.count} downtown office-to-residential conversions · ${formatUnits(t.units)} units · ${formatMoney(t.tpcMusd)}`,
    background: "src/assets/og/birken-lofts.jpg",
    caption: "Birken Lofts · 401 W. Ontario · Built by 3F Construction",
  };
}

// Satori reads woff/ttf (not woff2); @fontsource ships .woff alongside .woff2.
const fontFile = (path: string) => readFileSync(resolve(process.cwd(), "node_modules/@fontsource", path));
let fonts: SatoriOptions["fonts"] | undefined;
function loadFonts(): SatoriOptions["fonts"] {
  fonts ??= [
    { name: "Public Sans", data: fontFile("public-sans/files/public-sans-latin-700-normal.woff"), weight: 700, style: "normal" },
    { name: "Public Sans", data: fontFile("public-sans/files/public-sans-latin-400-normal.woff"), weight: 400, style: "normal" },
    { name: "Public Sans", data: fontFile("public-sans/files/public-sans-latin-600-normal.woff"), weight: 600, style: "normal" },
  ];
  return fonts;
}

type Child = OgNode | string;
interface OgNode { type: string; props: { style: Record<string, unknown>; children?: Child | Child[] } }
const div = (style: Record<string, unknown>, children?: Child | Child[]): OgNode => ({ type: "div", props: { style, children } });

function photoLayers(background: string): OgNode[] {
  const src = `data:image/jpeg;base64,${readFileSync(resolve(process.cwd(), background)).toString("base64")}`;
  const fill = { position: "absolute", top: 0, left: 0, width: 1200, height: 630 };
  return [
    { type: "img", props: { src, width: 1200, height: 630, style: { ...fill, objectFit: "cover", objectPosition: "center 25%" } } } as unknown as OgNode,
    div({ ...fill, backgroundImage: "linear-gradient(90deg, rgba(47,52,55,0.94) 0%, rgba(47,52,55,0.82) 45%, rgba(47,52,55,0.25) 100%)" }),
  ];
}

/** 1200×630 JPEG (photo backgrounds make PNGs ~1 MB; WhatsApp needs < 500 KB). */
export async function renderOgImage({ eyebrow, title, subtitle, background, caption }: OgContent): Promise<ArrayBuffer> {
  const content = div(
    { position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 80px" },
    [
      div({ display: "flex", flexDirection: "column", maxWidth: background ? 760 : 1040 }, [
        div({ fontSize: 22, fontWeight: 600, letterSpacing: 4, textTransform: "uppercase", color: "#F26122" }, eyebrow),
        div({ width: 96, height: 4, background: "#F26122", marginTop: 28, marginBottom: 36 }),
        div({ fontFamily: "Public Sans", fontWeight: 700, letterSpacing: -1, fontSize: title.length > 40 ? 60 : 76, lineHeight: 1.08 }, title),
        div({ fontSize: 30, color: "#E5E7EB", marginTop: 24, lineHeight: 1.35 }, subtitle),
      ]),
      div({ display: "flex", justifyContent: "space-between", fontSize: 20, color: "#F26122" }, [
        div({}, background ? "chicagopipeline.com" : "3F Construction"),
        div({}, caption ?? "chicagopipeline.com"),
      ]),
    ],
  );
  const tree = div(
    { width: "100%", height: "100%", display: "flex", position: "relative", background: "#2F3437", color: "#FFFFFF", fontFamily: "Public Sans" },
    [...(background ? photoLayers(background) : []), content],
  );
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], { width: 1200, height: 630, fonts: loadFonts() });
  const png = new Resvg(svg).render().asPng();
  // Baseline JPEG: some link previewers (Signal, WhatsApp) fail on progressive; sharp's mozjpeg preset forces progressive.
  const jpeg = await sharp(png).jpeg({ quality: 82, progressive: false }).toBuffer();
  return jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) as ArrayBuffer;
}
