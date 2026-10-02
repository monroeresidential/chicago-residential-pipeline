import { z } from "zod";

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  PORT: z.coerce.number().int().default(8787),
  MIGRATIONS_DIR: z.string().default("migrations"),
  SITE_BUILD_HOOK_URL: z.url().optional(),
  SITE_BUILD_HOOK_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  ALERT_FROM: z.string().optional(),
  ALERT_TO: z.string().optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Empty values in .env mean "not set".
  const parsed = ConfigSchema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));
  if (!parsed.success) {
    throw new Error(`invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}
