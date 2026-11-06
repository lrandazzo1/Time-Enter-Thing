/**
 * Outlook frequently writes Windows time-zone names as TZIDs ("Central Standard Time").
 * Map the common ones to IANA so DST is computed correctly by Intl.
 * Source: Unicode CLDR windowsZones.xml (territory 001 defaults).
 */
export const WINDOWS_TO_IANA: Record<string, string> = {
  "Dateline Standard Time": "Etc/GMT+12",
  "UTC-11": "Etc/GMT+11",
  "Aleutian Standard Time": "America/Adak",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time (Mexico)": "America/Tijuana",
  "Pacific Standard Time": "America/Los_Angeles",
  "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time (Mexico)": "America/Mazatlan",
  "Mountain Standard Time": "America/Denver",
  "Central America Standard Time": "America/Guatemala",
  "Central Standard Time": "America/Chicago",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Canada Central Standard Time": "America/Regina",
  "SA Pacific Standard Time": "America/Bogota",
  "Eastern Standard Time (Mexico)": "America/Cancun",
  "Eastern Standard Time": "America/New_York",
  "US Eastern Standard Time": "America/Indianapolis",
  "Atlantic Standard Time": "America/Halifax",
  "Venezuela Standard Time": "America/Caracas",
  "SA Western Standard Time": "America/La_Paz",
  "Pacific SA Standard Time": "America/Santiago",
  "Newfoundland Standard Time": "America/St_Johns",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Buenos_Aires",
  "UTC": "Etc/UTC",
  "Coordinated Universal Time": "Etc/UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "GTB Standard Time": "Europe/Bucharest",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "Israel Standard Time": "Asia/Jerusalem",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Russian Standard Time": "Europe/Moscow",
  "Arab Standard Time": "Asia/Riyadh",
  "Turkey Standard Time": "Europe/Istanbul",
  "Arabian Standard Time": "Asia/Dubai",
  "Pakistan Standard Time": "Asia/Karachi",
  "India Standard Time": "Asia/Calcutta",
  "Nepal Standard Time": "Asia/Katmandu",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok",
  "China Standard Time": "Asia/Shanghai",
  "Singapore Standard Time": "Asia/Singapore",
  "W. Australia Standard Time": "Australia/Perth",
  "Taipei Standard Time": "Asia/Taipei",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
};

/** Resolve a TZID (Windows or IANA, possibly quoted/prefixed) to a usable IANA zone, or null. */
export function resolveTzid(tzid: string | null | undefined, isValid: (tz: string) => boolean): string | null {
  if (!tzid) return null;
  const clean = tzid.replace(/^"|"$/g, "").replace(/^\/+/, "").trim();
  if (WINDOWS_TO_IANA[clean]) return WINDOWS_TO_IANA[clean];
  if (isValid(clean)) return clean;
  // Some exporters write e.g. "(UTC-06:00) Central Time (US & Canada)"
  const lower = clean.toLowerCase();
  if (lower.includes("central time")) return "America/Chicago";
  if (lower.includes("eastern time")) return "America/New_York";
  if (lower.includes("mountain time")) return "America/Denver";
  if (lower.includes("pacific time")) return "America/Los_Angeles";
  return null;
}
