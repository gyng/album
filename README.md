# album

![Screenshot 2025-02-02 at 06-49-43 Screenshot for docs](https://github.com/user-attachments/assets/92bd9ee8-af26-48af-b473-eb953e1d63c8)

[Live site](https://album-gyng.vercel.app/)

A zero-config, static, file-based album generator

- Dump your photos in a directory and run one command to deploy
- Index, search, explore images classified with deepseek-ai/Janus-Pro-1B
- Colour palette analysis
- Map mode
- EXIF support
- YouTube video support
- Next.JS static build, deployed on Vercel
- Custom image optimisation, resizing
- Light and dark modes

Goals

- Minimal friction between camera and publishing on web
- No running infrastructure
- EXIF and GPS data
- Photos are size-optimised for mobile viewing
- Free hosting!

This is a weekend project! Very, very, rough Next.JS project.

## Usage

You will need Node installed. The following steps are for deployment on Vercel, but you can deploy elsewhere &mdash; this is a standard Next.js application.

0. Clone the repo

   ```
   $ git clone https://github.com/gyng/album.git
   $ cd album/src/public/data/albums
   ```

1. Add your photos in a directory! Each album is a directory in `src/public/data/albums`.

   ```diff
     ├ /albums
   + │ ├─my-album
   + │ │ ├─pic1.jpg
   + │ │ └─cover.pic2.jpg
     │ └─my-album-with-manifest
     │   ├─album.json
     │   └─pic.jpg
     ├ /src
       └─public
         └─data
           └─albums
             └─my-album (optimised images cached here)
   ```

   Optionally, add an `album.json` to the album directory to do album-level configuration.

   ```ts
   {
      // Defaults to oldest-first
      sort?: "newest-first" | "oldest-first",
      // Does a partial match
      cover?: "pic1.jpg",
      externals?: Array<
         {
            type: "youtube",
            href: "https://www.youtube.com/embed/9bw3IL444Uo",
            date?: "2025-11-25"
         }
      >
   }
   ```

   Example

   ```json
   {
     "sort": "newest-first",
     "cover": "pic1.jpg",
     "externals": [
       {
         "type": "youtube",
         "href": "https://www.youtube.com/embed/9bw3IL444Uo",
         "date": "2019-11-07"
       }
     ]
   }
   ```

2. Deploy on Vercel (or elsewhere).

   Due to the large size of `public/data/*` (and a long time taken to optimise images), deploys are done manually from your (my?) local machine. Image optimisations/resizes are cached locally on `next build` or `vercel build`, so clear out `.resized_images` first if you want to regenerate them. If Next.js times out during `vercel build`, it's probably image optimisation taking way too long. In that case, run `npm run build` to optimise images first.

   ```
   $ npx vercel@latest login
   $ npx vercel@latest build --prod
   $ npx vercel@latest deploy --prebuilt --prod

   # If you hit the file limit
   $ npx vercel@latest deploy --prebuilt --prod --archive=tgz

   # Everything together for convenience
   $ npm run index:update && npx vercel@latest build --prod && npx vercel@latest deploy --prebuilt --prod
   ```

   If the build fails, try removing `.vercel` and reinitialising the project. Somehow this seems to happen a lot.

3. Index images by running the script at `/index/index.py` amd copying the result to `/src/public`. You need CUDA installed: see [index/README.md](index/README.md). Indexing is incremental, to reset delete `search.sqlite` (or whatever file the DB is in)

   ```sh
   $ cd index
   $ poetry install
   $ poetry run python index.py index --glob "../src/public/data/albums/**/*.jpg" --dbpath "search.sqlite"
   $ cp search.sqlite ../src/public/search.sqlite

   # or
   $ ./do-full-index.sh
   ```

   This can be done from Next.js app for convenience as well `npm run index:update`

4. To use the manifest creator, run `npm run dev` or `yarn dev` and visit your album's page. Click the `Edit` link at the top.

Be sure to configure your license for _all_ images in `src/License.tsx`. By default all photos are licensed under CC BY-NC 4.0.

## Wishlist

- EXIF stripping via filename
- Camera RAW
- Split data from app
- Automatic external storage
- Better content-based caching
- Links
- Local manifest saving
- Themes
- Polish
- Don't optimise all images until export/build-time

## Privacy notes

Analytics is integrated into the app at `_app.tsx`. Remove the `<Analytics />` component to remove any analytics. See [Next.js docs on analytics](https://vercel.com/docs/concepts/analytics) for more details.

## Dev notes

Image search is implemented using Sqlite on the browser (!real serverless!). An [analysis process](index/index.py) creates this database which is dumped into Next.js's `/public` directory.

The following fields are currently indexed

- Janus-Pro 1B tags and description
- EXIF
- Geocoded locations
- Colour palette

Previously a HTTP Range VFS driver was used for Sqlite: however the fallback either didn't work right or a new package version with that feature wasn't released. To make things easier to maintain I switched it back to the official SQLite WASM library.

Sqlite in the browser then loads this database and runs a trigram full-text search. I'm running SQLite on the main thread so it doesn't need access to shared array buffers. SABs need COOP/COEP headers setup. I ran things on the main thread to remove any need for COEP/COOP header hackery (on Vercel, very difficult to debug headers!). This does mean the full database (multi-megabyte) is loaded which can take some time.

<details>
<summary>Details on hack needed to get COOP/COEP headers working back when the range VFS was used:</summary>
Vercel is unable to serve the library's JS files from Next.js's `_next/` build directory with these headers, even with configuration set up in next.config.js and vercel.json. Middleware and API functions cannot redirect or add headers to these files either.

A service worker modified from [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) is used to add headers instead. This works, but has an unfortunate downside of requiring a page reload after initial install.

</details>

---

To take screenshots, visit http://localhost:3000/screenshot.html
