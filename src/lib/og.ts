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
  footer: string;
}

export const SITE_NAME = "Chicago Pipeline";

export function projectOgContent(p: Project): OgContent {
  return {
    eyebrow: p.confidence === "reported" ? `${SITE_NAME} · Reported` : SITE_NAME,
    title: displayName(p),
    subtitle: [
      p.units === null ? null : `${formatUnits(p.units)} units`,
      p.tpc_musd === null ? null : formatMoney(p.tpc_musd),
      STATUS_LABELS[p.status],
    ].filter(Boolean).join(" · "),
    footer: p.built_by_3f_url ? "Built by 3F Construction" : "By 3F Construction",
  };
}

/** The clean Chicago Pipeline card from the logo package (no stats, so it never goes stale). */
export function siteOgContent(_projects: readonly Project[]): OgContent {
  return {
    eyebrow: "",
    title: SITE_NAME,
    subtitle: "Office-to-residential conversions · Downtown Chicago",
    footer: "By 3F Construction",
  };
}

// Logo package palette and type.
const INK = "#201F1D";
const MUTED = "#5F5C57";
const PAPER = "#F3F2F2";
const ORANGE = "#F26430";

// Satori reads woff/ttf (not woff2); @fontsource ships .woff alongside .woff2.
const fontFile = (path: string) => readFileSync(resolve(process.cwd(), "node_modules/@fontsource", path));
let fonts: SatoriOptions["fonts"] | undefined;
function loadFonts(): SatoriOptions["fonts"] {
  fonts ??= [
    { name: "Cormorant Garamond", data: fontFile("cormorant-garamond/files/cormorant-garamond-latin-500-normal.woff"), weight: 500, style: "normal" },
    { name: "Lora", data: fontFile("lora/files/lora-latin-400-normal.woff"), weight: 400, style: "normal" },
  ];
  return fonts;
}

type Child = OgNode | string;
interface OgNode { type: string; props: Record<string, unknown> & { children?: Child | Child[] } }
const div = (style: Record<string, unknown>, children?: Child | Child[]): OgNode => ({ type: "div", props: { style, children } });

/** The pin + Chicago star mark (src/assets/brand/mark.svg). */
function mark(width: number): OgNode {
  return {
    type: "svg",
    props: {
      width, height: Math.round((width * 56) / 48), viewBox: "0 0 48 56",
      children: [
        { type: "path", props: { d: "M24,54 C24,54 5,34 5,22 a19,19 0 0 1 38,0 C43,34 24,54 24,54 Z", fill: "none", stroke: INK, strokeWidth: 2.6, strokeLinejoin: "round" } },
        { type: "path", props: { d: "M0,-10 L2,-3.46 L8.66,-5 L4,0 L8.66,5 L2,3.46 L0,10 L-2,3.46 L-8.66,5 L-4,0 L-8.66,-5 L-2,-3.46 Z", transform: "translate(24 22) scale(1.05)", fill: ORANGE } },
      ],
    },
  };
}

/** Satori drops word spaces in letter-spaced text with hyphenated words; non-breaking spaces survive. */
export const capsText = (text: string) => text.replace(/ /g, "\u00a0");

const caps = (size: number, color: string, text: string) =>
  div({ fontFamily: "Lora", fontSize: size, letterSpacing: size * 0.22, textTransform: "uppercase", color }, capsText(text));

/** 1200×630 baseline JPEG (some link previewers — Signal, WhatsApp — fail on progressive). */
export async function renderOgImage({ eyebrow, title, subtitle, footer }: OgContent): Promise<ArrayBuffer> {
  const isSite = eyebrow === "";
  const footerColor = footer.startsWith("Built") ? ORANGE : MUTED;
  const body = isSite
    ? [
        mark(88),
        div({ fontFamily: "Cormorant Garamond", fontWeight: 500, fontSize: 112, color: INK, marginTop: 20, lineHeight: 1 }, title),
        div({ marginTop: 28, display: "flex" }, [caps(20, MUTED, subtitle)]),
      ]
    : [
        div({ display: "flex", alignItems: "center", gap: 14 }, [mark(30), caps(18, MUTED, eyebrow)]),
        div({ fontFamily: "Cormorant Garamond", fontWeight: 500, fontSize: title.length > 32 ? 68 : 88, color: INK, marginTop: 36, lineHeight: 1.05, textAlign: "center", maxWidth: 1000 }, title),
        div({ fontFamily: "Lora", fontSize: 28, color: MUTED, marginTop: 28 }, subtitle),
      ];
  const tree = div(
    { width: "100%", height: "100%", display: "flex", background: PAPER, padding: 24 },
    [
      div(
        { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", border: "1px solid #D6D3CF", padding: "64px 48px 40px" },
        [
          div({ display: "flex" }, ""),
          div({ display: "flex", flexDirection: "column", alignItems: "center" }, body),
          div({ display: "flex" }, [caps(16, footerColor, footer)]),
        ],
      ),
    ],
  );
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], { width: 1200, height: 630, fonts: loadFonts() });
  const png = new Resvg(svg).render().asPng();
  // Baseline JPEG: some link previewers (Signal, WhatsApp) fail on progressive; sharp's mozjpeg preset forces progressive.
  const jpeg = await sharp(png).jpeg({ quality: 88, progressive: false }).toBuffer();
  return jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) as ArrayBuffer;
}
