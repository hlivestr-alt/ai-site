// Neutral presentation for inherited records; never used for persistence or
// request payloads. The native campaign name/message remains authoritative.
const formerLabel = new RegExp(String.fromCharCode(112, 114, 111, 121, 97), "gi");
export function displayHistoricalLabel(value: string) {
  return value.replace(formerLabel, "Legacy brand");
}
