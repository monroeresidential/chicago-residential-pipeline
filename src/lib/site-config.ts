export const SITE_URL = "https://chicagopipeline.com";
// "Chicago Pipeline suggestions" form in Monroe's Formspree account (same account as tetonflats.com).
export const FORMSPREE_ENDPOINT = "https://formspree.io/f/maenaqbd";
// Google Analytics 4 property for chicagopipeline.com. Only sent from the production host (see src/scripts/analytics.ts).
export const GA_MEASUREMENT_ID = "G-7M568CZ9PM";
export const PRODUCTION_HOST = "chicagopipeline.com";

// Brand: the site is a 3F Construction marketing site. Links to 3F carry campaign tags so 3F's analytics
// can attribute leads to the map. Monroe Residential Partners appears only as a footer link.
export const BRAND_NAME = "3F Construction";
const UTM = "utm_source=chicagopipeline&utm_medium=referral&utm_campaign=pipeline-map";
export const SITE_3F_URL = `https://3fconstruction.net/?${UTM}`;
export const CONTACT_3F_URL = `https://3fconstruction.net/contact-chicago-commercial-general-contractor/?${UTM}`;
export const PHONE_3F = { display: "(312) 296-4855", tel: "tel:+13122964855" };
export const MONROE_URL = "https://monroeresidential.com";
