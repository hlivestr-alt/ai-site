$ErrorActionPreference = 'Stop'
$secure = Read-Host 'New AI Site operator password (14+ characters)' -AsSecureString
$password = ConvertFrom-SecureString -SecureString $secure -AsPlainText
try {
  $hash = $password | & node (Join-Path $PSScriptRoot 'scripts\hash-password.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Password was not accepted.' }
} finally { $password = $null; $secure.Dispose() }
$envPath = Join-Path $PSScriptRoot '.env.local'
$lines = if (Test-Path -LiteralPath $envPath) { @(Get-Content -LiteralPath $envPath) } else { @() }
$lines = @($lines | Where-Object { $_ -notmatch '^(AI_SITE_PASSWORD_HASH|AI_SITE_SESSION_SECRET)=' })
$secret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$lines += "AI_SITE_PASSWORD_HASH=$hash"
$lines += "AI_SITE_SESSION_SECRET=$secret"
[IO.File]::WriteAllLines($envPath, $lines)
Write-Host 'Login configured in ignored .env.local. Restart only AI Site to apply it. Existing sessions will expire.'
