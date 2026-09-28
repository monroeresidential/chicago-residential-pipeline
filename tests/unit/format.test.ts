import { describe, expect, it } from "vitest";
import { displayName, escapeHtml, formatDate, formatMoney, formatUnits, hostname } from "../../src/lib/format";

describe("format", () => {
  it("formats units with separators and em dash for null", () => {
    expect(formatUnits(4210)).toBe("4,210");
    expect(formatUnits(null)).toBe("—");
  });

  it("formats millions and billions", () => {
    expect(formatMoney(179)).toBe("$179M");
    expect(formatMoney(6.5)).toBe("$6.5M");
    expect(formatMoney(1839.8)).toBe("$1.84B");
    expect(formatMoney(1000)).toBe("$1B");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(0)).toBe("$0M");
  });

  it("formats ISO dates without timezone drift", () => {
    expect(formatDate("2026-09-28")).toBe("September 28, 2026");
  });

  it("falls back to the address when there is no name", () => {
    expect(displayName({ name: null, address: "118 S. Clinton St" })).toBe("118 S. Clinton St");
    expect(displayName({ name: "The Smith", address: "223 W. Erie St" })).toBe("The Smith");
  });

  it("escapes HTML-significant characters", () => {
    expect(escapeHtml(`Riverside & "AmTrust" <DL3> Crain's`)).toBe(
      "Riverside &amp; &quot;AmTrust&quot; &lt;DL3&gt; Crain&#39;s",
    );
  });

  it("extracts a readable hostname", () => {
    expect(hostname("https://www.chicago.gov/city/en.html")).toBe("chicago.gov");
    expect(hostname("https://chicago.urbanize.city/post/x")).toBe("chicago.urbanize.city");
  });
});
