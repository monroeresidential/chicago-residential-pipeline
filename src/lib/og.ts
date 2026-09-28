import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori, { type SatoriOptions } from "satori";
import { displayName, formatMoney, formatUnits } from "./format";
import { STATUS_LABELS, type Project } from "./schema";
import { totals } from "./stats";

export interface OgContent {
  eyebrow: string;
  title: string;
  subtitle: string;
}

export function projectOgContent(p: Project): OgContent {
  return {
    eyebrow: p.confidence === "reported" ? "Chicago Pipeline · Reported" : "Chicago Pipeline",
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
    eyebrow: "Chicago Pipeline",
    title: "Downtown Office-to-Residential Conversions",
    subtitle: `${t.count} projects · ${formatUnits(t.units)} units · ${formatMoney(t.tpcMusd)}`,
  };
}

// Satori reads woff/ttf (not woff2); @fontsource ships .woff alongside .woff2.
const fontFile = (path: string) => readFileSync(resolve(process.cwd(), "node_modules/@fontsource", path));
let fonts: SatoriOptions["fonts"] | undefined;
function loadFonts(): SatoriOptions["fonts"] {
  fonts ??= [
    { name: "Newsreader", data: fontFile("newsreader/files/newsreader-latin-500-normal.woff"), weight: 500, style: "normal" },
    { name: "Inter", data: fontFile("inter/files/inter-latin-400-normal.woff"), weight: 400, style: "normal" },
    { name: "Inter", data: fontFile("inter/files/inter-latin-600-normal.woff"), weight: 600, style: "normal" },
  ];
  return fonts;
}

type Child = OgNode | string;
interface OgNode { type: string; props: { style: Record<string, unknown>; children?: Child | Child[] } }
const div = (style: Record<string, unknown>, children?: Child | Child[]): OgNode => ({ type: "div", props: { style, children } });

export async function renderOgPng({ eyebrow, title, subtitle }: OgContent): Promise<ArrayBuffer> {
  const tree = div(
    { width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 80px", background: "#00051B", color: "#FFFFFF", fontFamily: "Inter" },
    [
      div({ display: "flex", flexDirection: "column" }, [
        div({ fontSize: 22, fontWeight: 600, letterSpacing: 4, textTransform: "uppercase", color: "#8FB3CF" }, eyebrow),
        div({ width: 96, height: 4, background: "#33709B", marginTop: 28, marginBottom: 36 }),
        div({ fontFamily: "Newsreader", fontWeight: 500, fontSize: title.length > 40 ? 60 : 76, lineHeight: 1.08 }, title),
        div({ fontSize: 32, color: "#C9D2DC", marginTop: 24 }, subtitle),
      ]),
      div({ display: "flex", justifyContent: "space-between", fontSize: 22, color: "#8FB3CF" }, [
        div({}, "Monroe Residential Partners"),
        div({}, "pipeline.monroeresidential.com"),
      ]),
    ],
  );
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], { width: 1200, height: 630, fonts: loadFonts() });
  const png = new Resvg(svg).render().asPng();
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
}
