# Note to Dan (Benchmark) ahead of the call

Draft for Woody to send. Plain text below the line; trim as you like.

---

Dan,

Thanks for the audit, useful to have a third pair of eyes before we go live. A bit of background so the call is productive.

**Where the site is**

bgp.uk.com is not launched yet. It has not been submitted to Google Search Console and nothing links to it, which is why it is absent from Google rather than being penalised. We will submit the sitemap at go-live.

**The crawlability point**

Fair catch at the time you ran it. The site was a single-page React app, so a crawler fetching a URL got an empty shell and the content only arrived once JavaScript ran. That is now fixed: every page in the sitemap is rendered to static HTML at build time, so Google, Bing, Semrush and any share preview get the full text, headings and meta title for each page on the first request. The browser then takes over for navigation. If you re-run the Semrush crawl you should see word counts on every page and one title per route.

**How it is built**

- Front end: React with Vite and Tailwind, in our own GitHub repository.
- Hosting: Railway, deploys on every push. Apex redirects to www.
- Content: team, case studies, news and current opportunities come from our in-house platform (chatbgp.app), which the team already uses day to day. That is the CMS. Team names, titles, phones and photos come straight from the HR records there, so there is one source of truth and no second place to update.
- Business cards: /card/<name> pages and vCards are generated from the same records.

So we are not looking for a CMS, a hosting platform or a rebuild of the stack.

**Where we could use you**

- Design: a Figma pass on the visual layer. We would implement it in-house in the existing codebase, so we would want Figma files and a component-level spec rather than a theme or template. To save you rebuilding anything, I have put the current site into a Figma file you can work in directly: six desktop pages (home, leasing, a listing, a sector page, a case study, the team), the nav, footer and cards as components, and a brand page with the palette as variables and the type styles. It is a starting point for exploration, not a design system, so please do not quote for building one out. I will share it to your Figma email.
- SEO: a second opinion on page structure, titles and descriptions, schema markup for the office and people, and the go-live checklist (Search Console, Bing, Google Business Profile).
- Anything you spot in the re-crawl once it comes back clean.

It would help to have your costs split that way, design and SEO separately, with a day-rate option for the SEO side.

Speak soon,
Woody
