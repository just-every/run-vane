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

Enable the configured providers in Sign-in security before trying sign-in.
The existing linked Auth dependency remains available and uses Base's OIDC client.
Google and Entra OIDC use the vendored Base client with PKCE, nonce, state,
algorithm/issuer/audience validation and pinned discovery. Account admission always
uses Base's existing accounts, invitations, versions and sessions. No sign-in
creates an uninvited account. SAML accepts no email attribute as an association;
the installation owner supplies the NameID map. Sign-in attempts never modify it.

In the owner’s **Sign-in security** page, issue a SCIM credential for a configured
issuer. Copy it into the provisioning service once: Vane stores only a SHA-256
hash. Its service URL is `/scim/v2`; the credential opens only SCIM, never the
Stats API, event API, browser settings or owner recovery. Rotate it by issuing a
replacement for the same issuer, or revoke it. Both take effect on the next
request and are audited. Credentials are never included in analytics archives.

SCIM `POST /Users` requires `externalId` to be the provider’s stable OIDC subject
or SAML NameID. It creates a native Viewer with no site access and binds that
issuer and subject to the new person. It never finds or merges a person by email;
an address already in use or a subject belonging to someone else is refused.
Only the owner can grant site access afterwards through Team. Replaying the
same create returns the same resource and changes nothing. A changed subject or
email is not an update: resolve it through owner administration. Native accounts
created by an older unbound SCIM implementation are preserved without inferring
a federation binding from their email; an owner must review their identity.

`GET /Users` requires an exact `userName eq "…"` filter; it sees only this
credential’s issuer, and unfiltered directory enumeration is refused. `PATCH
/Users/<id>` with `replace active: false` (including the pathless object form),
or `DELETE /Users/<id>`, deactivates a provisioned non-owner and ends their
sessions, outstanding sign-in links, custodial API keys and push tokens by the
next request. Repeated deactivation does not produce another mutation or audit
event. A deactivated or owner-removed identity stays deactivated even if an old
create arrives later. SCIM never reactivates a person, raises a role, grants a
site, touches an owner or sends an invitation email.

## Owner recovery during an identity-provider outage

Use `rer signin --environment <name>` with the credentials that deployed this
installation. This deployment-custody door creates a fifteen-minute, one-use
owner sign-in link; it stores only its hash and audits its consumption. Open the
link, confirm sign-in, then open `/auth/security/break-glass` (also linked from
the SSO hold page). Ordinary owner email links, existing sessions, members and
SCIM credentials cannot open this recovery door.

Confirm **Disable SSO for outage recovery**. If you enrolled an authenticator, its code or a recovery
code is still required for that session; the authenticator requirement is
preserved. This explicitly disables the installation’s SSO requirement and
records `security.break-glass` in the audit. Repair the provider, sign in through
it and explicitly require SSO again. A recovery link does not grant SCIM access
or change anybody’s site access. The deployment credential is the authority;
never send the link or credential to another person.

Authenticator secrets are sealed under the installation secret; recovery codes
are stored only as keyed hashes. Pending enrollment expires after ten minutes.
Analytics history archives and site transfers exclude all federation attempts,
authenticator credentials, factor proofs and installation security policy; they
preserve analytics without importing sign-in authority. Full installation custody
continues to use the installation's existing private archive controls.

TEAM-002 follows ct’s 22 October 12:30Z identity and recovery ruling. Fixture
issuers prove the implemented protocol and access behavior. Provider acceptance
remains PARTIAL until a real Auth, Okta or Entra IdP tenant exercises SCIM; that
tenant and its administrator credentials are the named external dependency
`real-IdP-tenant`, not
replaced by the fixtures.
