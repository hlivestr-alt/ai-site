# Authentication

Users register with a normalized, unique email, display name and 12–128 character password containing a letter and number. Passwords use per-user random-salt `scrypt` hashes. Accounts begin in `PENDING_VERIFICATION`; a 24-hour, one-use email token activates the account and creates a session.

Sessions use 32-byte opaque random tokens. Only their SHA-256 hashes are stored in Postgres. A `HttpOnly`, `SameSite=Lax` cookie lasts 14 days; `Secure` is enabled for HTTPS. Each request checks the session against expiry, revocation and active user status. Logout revokes the session in Postgres and clears the cookie. Password reset revokes all existing sessions.

Recovery responds consistently for known and unknown active emails. Known users get a 30-minute, one-use token, stored hashed. The local mail sink writes links to ignored files in `data/mailbox` and shows them at `/dev/mailbox`. It works only when `APP_ENV=local`, `MAIL_MODE=development_file`, `APP_BASE_URL=http://127.0.0.1:3200`, and the request host is `127.0.0.1:3200`. No production email delivery exists; configure a real transport before public deployment.

Mutation APIs require a matching `Origin` header. JSON bodies are capped at 16 KiB. Database-backed rate counters limit register, login and recovery attempts per normalized email over a 15-minute window. Audit metadata never includes raw credentials or tokens.
