# Castellanos Photography

A polished, image-first photography portfolio built with plain HTML, CSS, and JavaScript. The homepage supports Spanish and English, with Spanish as the default language.

## Local preview

From the repository root, build the static site and start a local server:

```bash
node scripts/build.mjs
python3 -m http.server 8000 --directory public
```

Then open <http://localhost:8000>. Node 24+ is sufficient; there are no npm dependencies or credentials.

## Languages and contact

Use the language button in the main navigation to switch between Spanish and English. The choice is saved in the visitor's browser. The business name is **Castellanos Fotografía** in Spanish and **Castellanos Photography** in English.

The message links open Instagram Direct so visitors can ask about availability and services. Profile and direct-message URLs, both language versions of the copy, services, and translated portfolio captions live in [`js/content.js`](js/content.js).

## Replace or add photographs

- Replace a photograph while keeping the same filename, for example `assets/images/portfolio/portfolio-01.jpg`.
- To add a photograph, place it in `assets/images/portfolio/` and add one object to `portfolioItems` in `js/content.js`.
- Update `title`, `category`, and `alt` for every image. The optional `layout` value accepts `portrait`, `landscape`, or `tall`.
- Use JPEG or WebP files around 1600–2000 px on the longest edge. A hero image can be around 2400 px wide.

Images below the fold are lazy-loaded automatically. This starter includes AI-generated local placeholders; replace them with licensed client work before launch.

## GitHub Pages deployment

The workflow at `.github/workflows/pages.yml` packages only public files into `public/` and deploys that artifact whenever `main` is updated. It does not publish development files.

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

## Before publishing

- Replace the placeholder business details and photographs.
- Confirm the Instagram profile and direct-message links.
- Replace canonical and social metadata URLs if the final domain changes.
