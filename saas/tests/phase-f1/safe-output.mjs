export function safeOutput(raw) {
 const prefixes=[['OAUTH','CODE','MUST','NOT','APPEAR'].join('_'),['STATE','MUST','NOT','APPEAR'].join('_')];
 let value=String(raw);const markerLeaks=Number(prefixes.some(p=>value.includes(p)));
 for(const prefix of prefixes)value=value.replace(new RegExp(prefix+'[A-Za-z0-9_-]*','g'),'[CALLBACK_MARKER]');
 value=value.replace(/https?:\/\/[^\s"'<>]*[?&](?:code|state|auth_code)=[^\s"'<>]*/gi,'[OAUTH_TEMPORARY_URL]');
 return {value,markerLeaks};
}
