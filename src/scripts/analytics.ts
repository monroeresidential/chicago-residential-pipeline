import { PRODUCTION_HOST } from "../lib/site-config";

type Gtag = (...args: unknown[]) => void;
interface AnalyticsWindow {
  location: { hostname: string };
  dataLayer?: unknown[];
  gtag?: Gtag;
}
interface AnalyticsDocument {
  createElement(tag: "script"): { async: boolean; src: string };
  head: { appendChild(node: unknown): unknown };
}

/** Previews, localhost and tests must not send hits into the production GA property. */
export function shouldTrack(hostname: string): boolean {
  return hostname === PRODUCTION_HOST;
}

/** Google's standard gtag.js snippet, loaded only on the production host. */
export function initAnalytics(
  id: string,
  doc: AnalyticsDocument = document as unknown as AnalyticsDocument,
  win: AnalyticsWindow = window as unknown as AnalyticsWindow,
): void {
  if (!shouldTrack(win.location.hostname)) return;
  const script = doc.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  doc.head.appendChild(script);
  win.dataLayer = win.dataLayer || [];
  const dataLayer = win.dataLayer;
  win.gtag = function gtag() {
    // gtag.js expects the Arguments object itself, exactly as in Google's snippet.
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };
  win.gtag("js", new Date());
  win.gtag("config", id);
}
