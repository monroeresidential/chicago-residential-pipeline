import csvText from "../../data/projects.csv?raw";
import { parseProjectsCsv } from "./parse-projects";
import type { Project } from "./schema";

let cache: Project[] | undefined;

/** Build-time only. Throws with every validation error so a bad row fails the build. */
export function loadProjects(): Project[] {
  if (cache) return cache;
  const { projects, errors } = parseProjectsCsv(csvText);
  if (errors.length > 0) {
    throw new Error(`data/projects.csv has ${errors.length} error(s):\n${errors.join("\n")}`);
  }
  cache = projects;
  return cache;
}
