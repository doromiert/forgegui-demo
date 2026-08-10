# ForgeGUI Assets Popup Handoff

## Current Request

Add the Assets popup from this Figma node to the Assets experience:

- File: `ForgeGUI Official File V4`
- File key: `3hk2vHHnS6C3vBXkrW1ydn`
- Node: `824:6254`
- URL: <https://www.figma.com/design/3hk2vHHnS6C3vBXkrW1ydn/ForgeGUI-Official-File-V4?node-id=824-6254&m=dev>

The node is named **Community Asset View**. It is shown over the Assets overview and should open when a user selects a Community asset. Do not replace or redesign the static project cards and project controls.

## MCP State

Figma MCP is configured globally in:

`/home/doromiert/.config/opencode/opencode.jsonc`

The server is named lowercase `figma` and points to:

`https://mcp.figma.com/mcp`

`opencode mcp list` previously reported it connected. Restarting OpenCode should make the Figma tools available directly in the new session.

Use the Figma design-to-code skill/resource before inspecting the node. The previous session successfully called:

- `figma_get_design_context`
- `figma_get_metadata`
- `figma_get_variable_defs`
- `figma_get_screenshot`
- `figma_download_assets`

Reinspect node `824:6254` after restart rather than relying only on this summary.

## Figma Findings

The node is a `1920x1080` desktop frame with a blurred/dimmed Assets page behind a centered popup.

- Overlay: `rgba(0, 0, 0, 0.3)` and `backdrop-filter: blur(2.5px)`.
- Popup: `1315x700`, horizontal layout, `#0c0c0c`, `1px solid #272727`, `30px` radius.
- Popup shadow: `0 4px 250px 170px #000`.
- Left viewport column: `874x700`.
- Right metadata rail: `441x700`, background `#040404`.
- Left padding: `15px 20px 20px`; gap `15px`.
- Header: back button, title `Asset View`, and overflow button.
- Preview: approximately `834x612`, `#444`, `1px solid #1a1919`, `10px` radius and `10px` padding.
- Right author row: `48px` circular avatar, creator name, handle, blue Follow pill.
- Detail rail: asset-type badge, heart/count, title, clipped description, underlined `View Full Description` control.
- Bottom row: flexible blue `Download Free` pill plus circular share and favorite buttons.
- Primary blue: `#0077ff`.
- Secondary controls: `#1d1d1d`.
- Main font: `Atkinson Hyperlegible Next`.
- Type badge font: `Inter Tight`.
- Desktop action height: `44px`.

The exact screenshot was downloaded during the previous session to:

`/tmp/opencode/figma-asset-popup-824-6254.png`

That file is temporary. Fetch a fresh screenshot through MCP if it is unavailable.

## Existing Reusable UI

The shared popup controller in `scripts/site.js` already provides:

- `data-popup-open` and `data-popup-close`
- Dialog semantics
- Focus trapping
- Escape and backdrop dismissal
- Focus restoration

The shared popup styles in `styles/base.css` already match the Figma overlay, border, radius, fill, and large shadow closely. Reuse `fg-popupcontainer` and `fg-popup`; do not build a separate modal controller.

Useful local icons already matching the design:

- `icons/arrow.svg`
- `icons/3dots.svg`
- `icons/3d.svg`
- `icons/download.svg`
- `icons/share.svg`
- `icons/heart.svg`

`icons/people.svg` is not the same as the Figma add-person glyph. Prefer a small CSS/icon composition or download the exact exported Figma icon into the repository if exact fidelity requires it. Do not reference temporary MCP URLs in production code.

## Intended Implementation

Implement the Community Asset View on both Assets overview variants:

- `desktop/library/overview.html`
- `mobile/library/overview.html`

Recommended minimal structure:

1. Add one reusable popup fragment/template to both overview pages, preferably via a new shared template.
2. Add popup-specific CSS in a shared stylesheet linked by desktop and mobile overview pages.
3. Change generated Community catalog cards in `scripts/assets.js` from direct download links to `data-popup-open="community-asset-preview"` dialog triggers.
4. Retain the selected catalog item in JS and hydrate all popup fields before the shared popup controller opens it.
5. Bind Download and Share to `download_url || image_url`.
6. Render the asset image in the viewport for image entries. Use an explicit non-image viewport state for 3D/audio/file entries; do not invent a fake functional 3D viewer.
7. Make favorite/follow controls visually accurate but do not pretend they persist unless a real backend contract exists. If left interactive, clearly keep them local-only or disabled. Prefer no fake persistence.
8. Stack the preview and metadata rail on narrow screens; make the overlay scrollable and avoid a fixed `700px` height on mobile.

The public catalog RPC currently returns:

- `id`
- `slug`
- `title`
- `description`
- `creator_name`
- `image_url`
- `download_url`
- `category`
- `asset_type`
- `tags`
- `resolution`
- `aspect_ratio`
- `file_type`
- `published_at`
- `updated_at`

It does **not** return creator avatar/handle/id, like count, liked state, followed state, or price. Use honest fallbacks for missing display-only fields and do not add unsupported mutations without a backend change. The Figma label says `Free`, which is safe for the existing free public catalog.

## Current Assets Backend State

`scripts/assets.js` already does the following:

- Loads public catalog entries using `get_public_asset_catalog_entries`.
- Loads personal image/audio/3D outputs from completed `conversation_tasks`.
- Hydrates personal cards and the existing personal preview.
- Supports personal download, share, and View in Chat.
- Filters catalog cards using the Assets search input.

At present, clicking a generated public catalog card directly opens its URL. This is the behavior to replace with the new Community Asset View popup.

Local Supabase currently has zero completed task outputs and zero approved public catalog entries. The static catalog fixtures remain visible when the RPC is empty, so dynamic popup verification may require seeding an entry or adding fixture metadata without claiming it came from the backend.

## Files To Inspect First

- `scripts/assets.js`: catalog card creation, selection, download, and share logic.
- `desktop/library/overview.html`: desktop Assets overview and Community grid.
- `mobile/library/overview.html`: mobile Assets overview and Community grid.
- `styles/assets-overview.css`: desktop Assets cards.
- `styles/mobile-assets.css`: mobile Assets cards.
- `styles/base.css`: shared popup primitives.
- `scripts/site.js`: shared popup lifecycle.
- `desktop/library/project.html`: existing personal asset popup example.
- `styles/asset-project.css`: existing personal asset popup styles.
- `tools/site.mjs`: route script injection; it already injects `scripts/assets.js` for library routes.

## Worktree Warning

The repository has many uncommitted changes from the wider production-frontend integration. They are intentional. Do not revert or overwrite unrelated changes.

No code changes for the new Figma popup were made before this handoff. The only file added for this interruption is `HANDOFF.md`.

## Verification

After implementation:

1. Run `npm run check`.
2. Run the repository tests and production build from `package.json`.
3. Verify the generated desktop and mobile Assets overview routes include `scripts/assets.js` and the popup stylesheet/template.
4. Check keyboard opening, focus trap, Escape/backdrop close, and restored focus.
5. Check download/share with a real or seeded catalog row.
6. Compare desktop geometry against Figma node `824:6254` through MCP.
7. Check stacked popup behavior at mobile widths.

## Suggested Restart Prompt

```text
Read HANDOFF.md and continue implementing the Community Asset View popup from Figma node 824:6254. Use the connected lowercase figma MCP and its design-to-code resource to reinspect the node before editing. Preserve all existing uncommitted work, use the shared popup controller, wire the popup to public catalog data in scripts/assets.js, support desktop and mobile, then run checks/build/tests.
```
