# Your first website

Vane counts page loads, sources, campaigns and goals. Start with one website and the public paths you want to measure.

## Run Vane

Follow the [Run page](/run) to get Vane on your computer: `npx -y @runeditrun/rer dev just-every/run-vane`. Open the private sign-in link printed by `rer dev`, confirm the owner on **Finish setup**, then open **Your sites**. Keep that link private.

Vane starts empty. It never loads sample analytics into your installation.

## Add your website

In **Add a site**, give the site a name and its exact origin. For a website named Fern:

| Setting | Value |
| --- | --- |
| Site name | Fern |
| Website origin | `https://fern.example` |
| Allowed paths | `/`, `/pricing`, `/thanks` — one per line |
| Goals | `signup=/thanks` |
| Campaign labels | `launch` |
| Referring hostnames | `search.example` |

List public static paths and labels. Leave names, addresses and customer identifiers out. Choose the site's consent mode, sample rate and retention window.

Select **Prepare site**. The owner reviews the proposal in **Approvals** and selects **Approve change**. Administrators can prepare changes; the owner decides. Members can read reports.

## Install the script

Open your site, then **Settings**. Copy the tag under **Install the script** into the allowed pages on your website.

When consent is required, load the script after consent and set `window.vaneConsent = true` before it runs. If your website uses a Content Security Policy, allow your Vane origin in `script-src` and `connect-src`.

Visit an allowed page, then `/thanks?utm_campaign=launch`. A load of `/thanks` counts as the `signup` goal. You do not need a second event script.

## Read the report

**Report** places the current seven UTC days beside the preceding seven. Read **Visits (page loads)** and **Goal conversions**, followed by the source, campaign, page and goal tables. Change **From** and **Until (exclusive)** to inspect a different period.

Visits count accepted page loads. Reloading a page counts again. They do not measure unique people or sessions. See [Collection and coverage](collection.md) for the limits behind the numbers.

## Bring history with you

For an existing Umami installation, use **History → Import a document**. **Preview import** writes nothing; inspect the preview before **Apply import**. You can **Undo import** later. See [Move from Umami v2](umami-import.md) for the supported format.

To move a whole Vane installation, use **Data history → Download installation archive**. See [History and portability](history.md) before restoring or erasing data.
