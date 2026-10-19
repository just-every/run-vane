# Back up and restore

Your analytics history stays portable. Vane can import supported Umami history, undo an import, download an installation archive and restore into an empty installation.

## Import and undo

Open a site's **History**, choose an **Analytics document**, and select **Preview import**. Preview writes nothing. Check the rows and fingerprint under **Review import**, then select **Apply import**. See [Move in from Umami](umami-import.md) for the supported JSON and limits.

The **Import journal** records approval, checkpoints and committed records. **Undo import** removes that import's unchanged contributions. Repeat apply or undo while processing remains. Imported consent and sampling stay unknown.

## Download an archive

In **Data history**, select **Download installation archive**. The analytics archive contains every site's analytics, proposals, deletion journal and import custody. It excludes authentication.

Keep archives private. Checksums detect corruption; accept only your own archives.

## Restore an archive

Sign into an empty analytics installation. In **Data history → Restore an installation archive**, select the **Installation archive**. Supply a later export under **Later journal (optional)** when one exists, then select **Restore archive**.

An old archive is refused when the supplied later journal records a later deletion. A fresh installation cannot know about a journal you omit. Browser transfer is limited to 10 MB or 50,000 rows.

For larger installations, use RER's installation archive:

```sh
rer dev --stop
rer export --output ../vane-installation.rer
```

In an empty destination checkout, after `rer install`:

```sh
rer import --input ../vane-installation.rer --yes
```

These installation archives also carry access-control records, suspend local development identities, exclude sessions and secrets, and preserve migration history. Supply `--journal ../later-installation.rer` after erasure. Keep archives and private settings outside source control.

## Retention and erasure

Choose 30, 90 or 365 days, 13 or 25 months, or as long as the installation exists in collection settings. **Apply retention** erases events older than the window and nothing on a keep-forever site. Retention runs manually and erases one imported row per run; repeat until imported rows are processed.

The History page shows how full the store is against its capacity, D1's 10,240 MB database limit on Workers Paid (set `VANE_STORE_LIMIT_MB` to 500 on Workers Free). From 80% every app page warns and names the choices: a shorter retention window, or a scheduled warehouse export once that ships. Vane never drops or rolls up events to make room.

For a site's full history, select **Prepare history erasure**, then review and approve the permanent deletion as owner. Deletion retires affected import custody and records a deletion fence.

`rer reset --yes` destroys local state. Export first if you need to retain it.

## Audit history

Owners and administrators can open **Audit history** from the sites page. It lists every proposal and approval, settings change, import and undo, archive download, restore, erasure, retention run, sign-in and change prepared through the agent command API, with who did it, when and to what. Entries hold identifiers and counts only, so erasing a site's history keeps them without the erased data, and they travel in the installation archive.
