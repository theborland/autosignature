# PDF Signature Tool

A static, browser-only tool for adding a visible PNG signature to every page of one PDF at a time. PDF files and signatures are processed on the current device; there is no backend or upload service.

## Use the app

1. On first visit, choose a PNG signature and a representative PDF.
2. Drag the signature into place, resize it with the corner handle, and save.
3. Drop or choose one PDF. It is signed automatically using the saved placement.
4. Choose **Fix placement** if the signature needs adjustment. Saving the new placement signs the current PDF again.
5. Download the signed PDF. The selected document and result clear from the page so another PDF can be added.

The output filename has `_signed` appended, for example `Transcript.pdf` becomes `Transcript_signed.pdf`. The original file is unchanged. To change or forget the saved signature, use **Signature Settings** or **Forget signature**.

## Privacy

The signature PNG and placement are stored in IndexedDB for this browser profile. Selected PDFs and signed results are only kept in memory while the page is open. They are not written to persistent browser storage or sent to a server. Clearing site data removes the saved signature. Use a separate operating-system or browser account on shared computers.

This tool applies a visible image. It does not create a certificate-based digital signature or independently verify the signer's identity.

## Local development

Requires Node.js 20 or newer and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Build the static site with `npm run build`; generated files are written to `dist/`. Run `npm run preview` to view the production build locally.

## GitHub Pages deployment

1. Push this repository to GitHub.
2. In **Settings → Pages**, choose **GitHub Actions** as the deployment source.
3. Push to `main` or run **Deploy to GitHub Pages** from the Actions tab.
4. Open the Pages URL shown in the deployment details after the workflow succeeds.

The workflow builds with `npm ci` and `npm run build`, then publishes only `dist/`. Vite emits relative asset paths for GitHub Pages project URLs. A service worker caches the app and bundled libraries after the first successful load for offline use.

## Checks

Test first-time setup, refresh and returning setup, signature replacement/forgetting, one-page and multipage PDFs, rotated pages, different page sizes, damaged or password-protected PDFs, automatic signing, placement correction, download clearing, and offline processing after the app has loaded. Use only synthetic test files; do not commit real signatures or confidential documents.
