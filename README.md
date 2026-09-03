# Don Charlie Photography

A polished, image-first photography portfolio built with plain HTML, CSS, and JavaScript. It has no framework, database, CMS, or required build step and is ready for GitHub Pages or GitLab Pages.

## Local preview

From the repository root, start any static file server:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` directly also works, but a local server more closely matches Pages hosting.

## Edit business information

All frequently changed text and links live at the top of [`js/content.js`](js/content.js). Update the business name, photographer name, email, location, Instagram URL, biography, availability, services, and portfolio records there. Layout and interaction code do not need to change.

## Replace or add photographs

- Replace a photograph while keeping the same filename, for example `assets/images/portfolio/portfolio-01.jpg`.
- To add a photograph, place it in `assets/images/portfolio/` and add one object to `portfolioItems` in `js/content.js`.
- Update `title`, `category`, and `alt` for every image. The optional `layout` value accepts `portrait`, `landscape`, or `tall`.
- Use JPEG or WebP files around 1600–2000 px on the longest edge. A hero image can be around 2400 px wide.

Images below the fold are lazy-loaded automatically. This starter includes AI-generated local placeholders; replace them with licensed client work before launch.

## GitHub Pages deployment

The workflow at `.github/workflows/pages.yml` deploys the repository root whenever `main` is updated.

1. Push this repository to GitHub with `main` as the default branch.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. Push to `main`, or run the workflow manually from the **Actions** tab.

For a custom domain, add it in **Settings → Pages**, configure the DNS records shown by GitHub, then optionally commit the generated `CNAME` file. Update the canonical and sharing URLs in `index.html`, plus the URL in `sitemap.xml` and `robots.txt`.

## GitLab Pages deployment

`.gitlab-ci.yml` copies the static site into the `public/` artifact GitLab Pages expects.

1. Push the repository to GitLab.
2. Ensure the default branch is `main`, or update the branch rule in `.gitlab-ci.yml`.
3. Let the `pages` pipeline finish.
4. Find the published address under **Deploy → Pages**.

For a custom domain, add it under **Deploy → Pages → New domain**, follow GitLab's DNS verification instructions, and update the canonical URLs described above.

## Contact form

The form validates in the browser and opens a pre-filled email in the visitor's mail app. To connect Formspree, Getform, Netlify Forms, or another endpoint later, replace the submit handler in `js/site.js` and add the provider's form attributes.

## Before publishing

- Replace the placeholder business details and photographs.
- Confirm the email and social links.
- Replace canonical and social metadata URLs if the final domain changes.
- Add a legally reviewed privacy policy if you connect form processing or analytics.
