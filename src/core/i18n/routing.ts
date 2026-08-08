import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // Additional locales can be appended here without further
  // architectural changes — see docs/02-architecture/05-DependencyRules.md.
  locales: ["en"],
  defaultLocale: "en",
});
