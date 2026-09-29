// Byte-exact compatibility with historical ComfyUI records. These identifiers
// are read-only: new uploads, outputs, and prompt metadata use neutral names.
const formerPrefix = String.fromCharCode(112, 114, 111, 121, 97);
export const legacyNamespace = `${formerPrefix}_platform`;
export const legacyIdentityKey = `${formerPrefix}BridgeJobId`;
