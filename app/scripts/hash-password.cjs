/* eslint-disable @typescript-eslint/no-require-imports */
const { randomBytes, scryptSync } = require("node:crypto");

let password = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { password += chunk; });
process.stdin.on("end", () => {
  password = password.replace(/\r?\n$/, "");
  if (password.length < 14) { console.error("Password must contain at least 14 characters."); process.exitCode = 1; return; }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  process.stdout.write(`scrypt:${salt.toString("hex")}:${hash.toString("hex")}`);
});
