import { describe, expect, it } from "vitest";
import { projectsToCsv, projectsToJson } from "../../src/lib/export";
import { loadProjects } from "../../src/lib/load-projects";
import { parseProjectsCsv } from "../../src/lib/parse-projects";
import { makeProject } from "./fixtures";

describe("projectsToCsv", () => {
  it("round-trips the real dataset through the CSV parser", () => {
    const projects = loadProjects();
    const { projects: back, errors } = parseProjectsCsv(projectsToCsv(projects));
    expect(errors).toEqual([]);
    expect(back).toEqual(projects);
  });

  it("writes nulls as empty cells and joins sources with ' | '", () => {
    const csv = projectsToCsv([makeProject({ name: null, sources: ["https://a.example/", "https://b.example/"] })]);
    expect(csv).toContain("111-w-monroe,1,,111 W. Monroe St");
    expect(csv).toContain("https://a.example/ | https://b.example/");
    expect(csv).not.toContain("null");
  });
});

describe("projectsToJson", () => {
  it("wraps projects with as_of", () => {
    const parsed = JSON.parse(projectsToJson([makeProject()], "2026-09-28"));
    expect(parsed.as_of).toBe("2026-09-28");
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0].id).toBe("111-w-monroe");
  });
});
