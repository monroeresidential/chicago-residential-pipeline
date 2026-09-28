/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_PMTILES_URL?: string;
  readonly PUBLIC_MAP_ASSETS_URL?: string;
  readonly PUBLIC_CF_BEACON_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
