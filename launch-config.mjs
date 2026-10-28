export const LAUNCH = Object.freeze({
  niche: 'garden-landscaping',
  area: 'Bristol and nearby BS postcode areas',
  matchingPolicy: 'exclusive',
  consentVersion: '2026-10-28-exclusive-garden',
});
export function isLaunchPostcode(postcode) {
  return /^BS\d{1,2}\s?\d[A-Z]{2}$/.test(String(postcode).trim().toUpperCase());
}
export function isLaunchOutward(postcode) {
  return /^BS\d{1,2}$/.test(String(postcode).trim().toUpperCase());
}
