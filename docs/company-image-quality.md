# Company profile photography

Brand and landlord cover photographs now use saved originals. Gallery thumbnails remain small previews; they are never enlarged into cover photographs or PDF hero strips.

## Discovery and review

- Use the company's confirmed official website and verified store listings. Domain confirmation remains required; a matching word in an unrelated page's URL is insufficient.
- Extract the largest responsive image, including lazy-loaded images and picture elements. Follow official shop/location or landlord portfolio/property pages even when the homepage already has many images.
- Exclude obvious logos, icons, portraits, graphics and promotional assets before applying candidate limits. Preserve the page where each landlord photograph was discovered.
- Decode downloaded pixels, reject undersized or unsuitable proportions, normalise orientation and retain up to 2400 pixels without enlarging the source. Automatic photography needs a long edge of at least 800 pixels and a short edge of at least 500 pixels.
- Require a valid visual review confirming relevance, photography and quality. Missing/malformed provider output cannot approve a new image. Rank the approved pool; brands favour shopfronts/interiors, landlords favour buildings/interiors.
- Compare image content to avoid duplicate imports, including variants with different URLs. A rejected candidate cannot suppress a later acceptable one.

## Refresh and recovery

Refresh images searches again instead of treating any five saved images as success. Background preparation also counts reviewed photographs, not logos. Manual uploads and pinned choices remain untouched. Legacy automatic images are reviewed in bounded batches. Unsuitable and duplicate automatic records are marked for review, not deleted; originals remain in Image Studio.

Existing acceptable automatic photos are only superseded after a complete replacement set has been saved. Partial or failed searches retain them. A failed image GET no longer deletes its database row. Refresh reports no suitable results, unavailable review or a time limit explicitly. Network/model work has a four-minute budget; database and storage latency may add time.

## Display and user choice

The same selector is used by desktop, phone, the saved flagship endpoint and brand packs. Logos, review-held images and known poor-resolution files cannot become cover photos. A suitable explicit cover choice takes priority. If an original fails to load, the profile tries the next suitable saved image before showing a compact placeholder.

Gallery controls show **Cover**, **Saved choice** and **Logo**. Open a suitable image and choose **Use as cover photo**. Existing multiple pins remain recorded; unpin the current choice before selecting another. Company access and editing rules are unchanged.

## Checks

Regression tests exercise responsive discovery, provenance, strict visual-review parsing, real image decoding, size/quality rejection, redirects and download bounds, source diversity, duplicate handling, failure preservation, original-only image delivery, PDF rendering inputs, cover selection and component fallback. Menu image CSE fallback also requires an official source page and meaningful image dimensions.

The visual review remains probabilistic. Sites may block requests or provide no suitable photography. In that case the app should report the limitation and offer the saved-image workflow, rather than fill the space with an unrelated logo or thumbnail. This release does not bulk-refresh the CRM.
