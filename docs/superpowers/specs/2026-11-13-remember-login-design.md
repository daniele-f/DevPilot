# DP #10000005: Remember login

Implementation scope for DP #10000005, following the request to continue work.

Add an unchecked “Remember me” checkbox to the sign-in form. It does not appear during registration, password reset, or password recovery. Never store passwords.

For local login, an unchecked box issues a session cookie with the existing eight-hour server expiry. A checked box issues a persistent cookie and server session lasting 30 days. Preserve token hashing, rotation, expiry checks, and logout revocation.

For production login, use session storage when unchecked and persistent storage when checked, including refreshed tokens. Logout must remove stored authentication in either mode. Existing restored sessions remain usable until logout or expiry.

## Approaches

Recommended: choose session persistence at sign-in for both local and production authentication. This matches the existing shared sign-in form and makes the option consistent.

Alternative: implement only local persistence. This is smaller but leaves the same option unavailable or misleading in production.

## Verification

Add backend coverage for ordinary versus remembered cookie attributes, matching database expiry, invalid credentials, token rotation, and logout revocation. Run backend checks and the production build. The user owns frontend suites and browser acceptance testing.

User testing: sign in with each checkbox setting, reload, close and reopen the browser, and verify remembered login and explicit logout. Browser session restoration may preserve session cookies depending on browser settings.
