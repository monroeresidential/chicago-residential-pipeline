import { describe, expect, it } from "vitest";
import { llmsFullTxt, llmsTxt, mdEscape, projectLine, projectMarkdown, aboutMarkdown, suggestSection } from "../../src/lib/llm-text";
import { loadProjects } from "../../src/lib/load-projects";
import { makeProject } from "./fixtures";

const SITE = "https://chicagopipeline.com";
const FORM = "https://formspree.io/f/maenaqbd";
const projects = loadProjects();

describe("mdEscape", () => {
  it("escapes Markdown-significant characters", () => {
    expect(mdEscape("a|b [c] *d* _e_ `f` <g> \\h")).toBe("a\\|b \\[c\\] \\*d\\* \\_e\\_ \\`f\\` \\<g\\> \\\\h");
  });
});

describe("projectLine", () => {
  it("links the project's Markdown page and lists key facts", () => {
    expect(projectLine(makeProject(), SITE)).toBe(
      "- [111 W. Monroe St — Harris Bank building](https://chicagopipeline.com/projects/111-w-monroe.md): 345 units, $179M, Approved, LaSalle Reimagined",
    );
  });

  it("shows — for missing values and adds markers", () => {
    const line = projectLine(
      makeProject({ name: null, units: null, tpc_musd: null, confidence: "reported", built_by_3f_url: "https://3fconstruction.net/project/birken-lofts/", flag: "Listed for sale" }),
      SITE,
    );
    expect(line).toContain("— units, —,");
    expect(line).toContain("Built by 3F Construction, reported — not on DPD map, ⚠ Listed for sale");
    expect(line).not.toMatch(/null|undefined/);
  });

  it("cannot be broken by Markdown in the data", () => {
    const line = projectLine(makeProject({ name: "Evil] (x) | *bold*" }), SITE);
    expect(line).toContain("[111 W. Monroe St — Evil\\] (x) \\| \\*bold\\*](");
  });
});

describe("llmsTxt", () => {
  const txt = llmsTxt(projects, "2026-09-28", SITE, FORM);

  it("starts with the llms.txt title and summary", () => {
    expect(txt.startsWith("# Chicago Pipeline\n\n> ")).toBe(true);
    expect(txt).toContain(`${projects.length} projects`);
    expect(txt).toContain("Data as of 2026-09-28");
  });

  it("lists every project once, sorted by units", () => {
    const lines = txt.split("\n").filter((l) => l.startsWith("- [") && l.includes("/projects/"));
    expect(lines).toHaveLength(projects.length);
    const units = lines.map((l) => Number((l.match(/\): ([\d,]+|—) units/)?.[1] ?? "0").replace(/,/g, "") || 0));
    expect(units).toEqual([...units].sort((a, b) => b - a));
  });

  it("links the data files and documents the suggestion endpoint", () => {
    for (const path of ["/llms-full.txt", "/data/projects.csv", "/data/projects.json", "/data/projects.geojson", "/about.md"]) {
      expect(txt).toContain(`${SITE}${path}`);
    }
    expect(txt).toContain(FORM);
    expect(txt).toContain("reviews every submission");
    expect(txt).not.toMatch(/null|undefined|localhost/);
  });
});

describe("llmsFullTxt", () => {
  it("has a section per project with every published field and no nulls", () => {
    const txt = llmsFullTxt(projects, "2026-09-28", SITE, FORM);
    for (const p of projects) expect(txt).toContain(`\n## ${p.name ?? p.address}\n`);
    expect(txt).toContain("- Units: ");
    expect(txt).toContain("- Coordinates: ");
    expect(txt).toContain("| Stage | Projects | Units |");
    expect(txt).not.toMatch(/null|undefined/);
  });
});

describe("projectMarkdown", () => {
  it("renders a standalone document", () => {
    const md = projectMarkdown(makeProject({ developer: null }), "2026-09-28", SITE);
    expect(md.startsWith("# Harris Bank building\n")).toBe(true);
    expect(md).toContain("- Developer: —");
    expect(md).toContain("- Units: 345");
    expect(md).toContain("- Project page: https://chicagopipeline.com/projects/111-w-monroe");
    expect(md).toContain("Data as of 2026-09-28");
  });
});

describe("aboutMarkdown", () => {
  it("contains the methodology and the suggestion endpoint", () => {
    const md = aboutMarkdown("2026-09-28", SITE, FORM);
    expect(md).toContain("# How we track the pipeline");
    expect(md).toContain("developer");
    expect(md).toContain(FORM);
  });
});

describe("agent instructions (final review fixes)", () => {
  const section = suggestSection(FORM, SITE);

  it("points to the real form URL and gives a curl example", () => {
    expect(section).toContain("https://chicagopipeline.com/about#suggest");
    expect(section).not.toContain("bottom of the About page");
    expect(section).toContain(`curl -X POST ${FORM}`);
    expect(section).toContain("-H 'Accept: application/json' -H 'Content-Type: application/json'");
  });

  it("explains what a project id is, and every project lists its id", () => {
    expect(section).toContain("the slug in the project's URL, e.g. 111-w-monroe");
    expect(projectMarkdown(makeProject(), "2026-09-28", SITE)).toContain("- ID: 111-w-monroe");
  });

  it("llms.txt explains what each status means", () => {
    const txt = llmsTxt(projects, "2026-09-28", SITE, FORM);
    expect(txt).toContain("permitted (renovation permit issued; construction not yet confirmed underway)");
    expect(txt).toContain("planning (acquired or proposed; entitlements or financing not yet in place)");
  });
});

describe("3F Construction branding in LLM formats", () => {
  it("says the pipeline is maintained by 3F Construction", () => {
    const txt = llmsTxt(projects, "2026-09-28", SITE, FORM);
    expect(txt).toContain("maintained by 3F Construction");
    expect(txt).not.toMatch(/Monroe Residential (reviews|Partners\. )/);
    expect(suggestSection(FORM, SITE)).toContain("3F Construction reviews every submission");
  });

  it("links 3F-built projects to 3F's project page", () => {
    const md = projectMarkdown(makeProject({ built_by_3f_url: "https://3fconstruction.net/project/birken-lofts/" }), "2026-09-28", SITE);
    expect(md).toContain("- Built by 3F Construction: https://3fconstruction.net/project/birken-lofts/");
  });
});
