# People and approvals

Vane has three roles. Every change to what Vane collects waits for the owner.

## Roles

| Role | Can do |
| --- | --- |
| Owner | Everything: approve or reject changes, import and undo history, download and restore archives, apply retention and erase history. |
| Administrator | Read every report and prepare changes: add a site, change collection settings or ask to erase a site's history. |
| Member | Read sites and reports. Members do not see proposals. |

A person whose access is revoked loses it on their next request. People join through the installation's invitation door, `POST /auth/invite` with their email address, display name and role; the invitation arrives as an ordinary sign-in email.

## Prepare a change

An owner or administrator prepares a change in the app: **Prepare site** in **Add a site**, **Prepare settings change** in a site's **Settings**, or **Prepare history erasure**. Nothing changes yet. Agents prepare the same changes through the [agent command protocol](commands.md).

## Approve or reject

Open **Approvals**. Each proposal shows what it does, who prepared it and when, and the full proposed values. The owner selects **Approve change** (or **Approve erasure**) or **Reject change**. Vane records who decided and when.

Each proposal applies once. Approving it again is refused, and a settings change prepared before the site changed is refused rather than applied over newer settings. Prepare it again from the current settings.
