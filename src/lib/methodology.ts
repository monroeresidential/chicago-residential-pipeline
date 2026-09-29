export const METHODOLOGY = {
  intro:
    "This map covers office-to-residential conversions in downtown Chicago. It starts from the City of Chicago Department of Planning and Development (DPD) map published in June 2026, which lists 25 projects totaling 3,930+ units and $1.8B in project costs. We add projects that have been publicly reported but do not yet appear on the DPD map, and label them \"Reported — not on DPD map.\"",
  sources: [
    "City of Chicago DPD, Downtown Chicago Office-to-Residential Conversions (June 2026)",
    "City of Chicago LaSalle Street Reimagined proposals and Mayor's Office press releases",
    "Reporting from Crain's Chicago Business, Chicago Sun-Times, Urbanize Chicago, Chicago YIMBY, The Real Deal, Cooperator News, Block Club Chicago and Preservation Chicago",
    "Chicago building permit records (via Chicago Cityscape)",
  ],
  reconciliation:
    "Where the DPD map and another source report different figures, the DPD value is shown and the alternate figure is listed in the project's notes. Where DPD has no figure, we use the best available public source. The one exception is a figure confirmed directly by the project's developer, which we show instead (with the DPD figure in the notes).",
  stages: [
    { label: "Planning", description: "Acquired or proposed; entitlements or financing not yet in place." },
    { label: "Approved", description: "Zoning, Plan Commission and/or City Council approvals granted; no construction permit yet." },
    { label: "Permitted", description: "Renovation permit issued; construction not yet confirmed underway." },
    { label: "Under construction", description: "Work confirmed underway." },
    { label: "Completed", description: "Open to residents." },
  ],
  riskNote: "A ⚠ marks projects with a known risk, such as litigation or a pending sale.",
  disclaimer:
    "This map is compiled from public sources for informational purposes only. Figures are as reported and may change. It is not an offer, solicitation or investment advice.",
};
