# Organization sign-in and authenticators

Every account has **Sign-in security** in its navigation. Set up an authenticator,
enter a six-digit code, and save the eight recovery codes shown once. A recovery
code replaces the authenticator once after primary sign-in. Enrollment uses a
160-bit random TOTP secret, SHA-1, six digits and thirty-second steps; the server
allows one step of skew, and consumes each successful step globally. Authentication
uses wall time, independently of analytics' local simulation clock. Five attempts
per account and per session in five-minute aligned windows bound guesses.

The owner can require single sign-on or an authenticator for every account,
including owners. The owner's current session must first demonstrate the method
being required. The requirement applies to existing sessions on their next request.
An account without an authenticator can reach only enrollment and sign-out;
an enrolled account must prove the factor in each new primary session. Private
account, dependency, setup, analytics and export doors share that fence. A bearer
API key whose custodian has not enrolled is refused while second steps are required.
Service webhooks retain their existing scoped credentials. New private browser
routes inherit the same fence before they ship.

These installation bindings stay private; configure them with the deployment's
secret entry door, never in source, URLs or browser configuration:

- `VANE_OIDC_PROVIDERS`: JSON array of Base `IdentityProviderConfig` objects.
  Google Workspace uses `id: "google", preset: "google"`; Microsoft Entra uses
  `id: "microsoft", preset: "microsoft"` with a tenant-specific `tenant` and an
  explicit server-owned `subjectEmails` map. Okta is also supported by Base.
  Supply the registered client id and its private key or client-secret method.
  Use the exact callback `/auth/oidc/<id>/callback` on the installation origin.
- `OIDC_TRANSACTION_SECRET`: an independent random secret of at least 32
  characters, distinct from `SESSION_SECRET`, for Base's sealed PKCE transactions.
- `VANE_SAML_CONFIG`: JSON object containing the exact IdP `issuer`, HTTPS
  `entryPoint`, PEM public signing certificate `idpCert`, and `subjects`, a map
  from NameID to an existing operator email. The public metadata is at
  `/auth/saml/metadata`; configure the ACS at `/auth/saml/callback`. Both the
  response and assertion must be signed by that certificate. Only solicited,
  browser-bound, one-use responses with the exact audience, recipient,
  destination, issuer, request id and live time bounds are admitted.
- `VANE_SCIM_TOKEN`: a separately generated high-entropy bearer credential held
  by the provisioning service. The service URL is `/scim/v2`. The token has no
  browser endpoint and is never included in an analytics archive.

Enable the configured providers in Sign-in security before trying sign-in.
The existing linked Auth dependency remains available and uses Base's OIDC client.
Google and Entra OIDC use the vendored Base client with PKCE, nonce, state,
algorithm/issuer/audience validation and pinned discovery. Account admission always
uses Base's existing accounts, invitations, versions and sessions. No sign-in
creates an uninvited account. SAML accepts no email attribute as an association;
the installation owner supplies the NameID map. Sign-in attempts never modify it.

SCIM `POST /Users` may associate only a live invitation previously issued by the
owner; it cannot create a role or activate an account. The person still proves
identity through SSO to accept the invitation. `GET /Users` requires an exact
`userName eq "…"` filter; unfiltered directory enumeration is refused. `PATCH
/Users/<id>` with `replace active: false` (including the pathless object form),
or `DELETE /Users/<id>`, deactivates a non-owner immediately and revokes their
sessions, links, custodial API keys and native credentials. SCIM cannot reactivate
people, alter roles or remove an owner. Its changes are audited without credentials.

Authenticator secrets are sealed under the installation secret; recovery codes
are stored only as keyed hashes. Pending enrollment expires after ten minutes.
Analytics history archives and site transfers exclude all federation attempts,
authenticator credentials, factor proofs and installation security policy; they
preserve analytics without importing sign-in authority. Full installation custody
continues to use the installation's existing private archive controls.

The conservative identity association, SCIM authority, enrollment and enforcement
semantics above are adopted for TEAM-002 pending ct approval. Fixture-issuer proof
is the contract's provider boundary; no paid account or live sandbox is required.
