# album

![Screenshot 2025-02-02 at 06-49-43 Screenshot for docs](https://github.com/user-attachments/assets/92bd9ee8-af26-48af-b473-eb953e1d63c8)

[Live site](https://album-gyng.vercel.app/)

A zero-config, static, file-based album generator

- Dump your photos in a directory and run one command to deploy
- Index, search, explore images classified with deepseek-ai/Janus-Pro-1B
- Colour palette analysis
- Map mode
- Slideshow, with clock
- Slideshow random/similar playback modes
- EXIF support
- YouTube video support
- Local video support (FFmpeg web-optimised transcode)
- Video technical metadata details panel (codec/profile/fps/bitrate/filesize/date)
- Viewport-based local video autoplay/pause
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

1. Add your photos/videos in a directory! Each album is a directory in `src/public/data/albums`.

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

   Local video files in album directories are auto-detected (`.mp4`, `.mov`, `.m4v`, `.webm`, `.mkv`, `.avi`) and transcoded to web-optimised MP4 during build. On album pages, local videos are auto-played when in viewport and paused when out of viewport.

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
         } | {
            type: "local",
            href: "clip.mov",
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

   Notes for local videos:

   - `date` is optional. If omitted, original capture date is extracted from source metadata when available.
   - The details panel for local videos shows original-file technical metadata (codec, profile, framerate, bitrate, duration, resolution, audio codec, container, filesize).
   - Windows `:Zone.Identifier` sidecar files are deleted/skipped automatically during album scan.

2. Deploy on Vercel (or elsewhere).

   Due to the large size of `public/data/*` (and a long time taken to optimise images/videos), deploys are done manually from your (my?) local machine. Image and video optimisations are cached locally on `next build` or `vercel build` (`.resized_images` / `.resized_videos`). Local videos are transcoded to web-optimised MP4 outputs via FFmpeg and only the optimised output path is used for playback. Outdated cached video sizes are pruned automatically.

   ```
   $ npx vercel@latest login
   $ npx vercel@latest build --prod
   $ npx vercel@latest deploy --prebuilt --prod

   # If you hit the file limit
   $ npx vercel@latest deploy --prebuilt --prod --archive=tgz

   # Everything together for convenience
   $ npx vercel@latest pull && npm run index:update && npx vercel@latest build --prod && npx vercel@latest deploy --prebuilt --prod
   ```

   If the build fails, try removing `.vercel` and reinitialising the project. Somehow this seems to happen a lot.

3. Index images by running the script at `/index/index.py` and copying the result to `/src/public`. You need CUDA installed: see [index/README.md](index/README.md). Indexing is incremental, to reset delete `search.sqlite` (or whatever file the DB is in)

   ```sh
   $ cd index
   $ uv sync
   $ uv run python index.py index --glob "../albums/**/*.jpg" --dbpath "search.sqlite" --model-profile hybrid
   $ cp search.sqlite ../src/public/search.sqlite

   # or
   $ ./do-full-index.sh

   # embeddings-only refresh merged into the active public DB
   $ ./do-embeddings-index.sh
   ```

   This can be done from the Next.js app for convenience as well with `npm run index:update` or `npm run index:embeddings:update`

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
- SigLIP image embeddings for similarity search and slideshow mode
- EXIF
- Geocoded locations
- Colour palette

The slideshow supports two playback modes:

- `Random`: default behaviour, chooses the next image at random.
- `Similar`: uses the current image as the seed and advances through visually similar photos.

You can enable similarity mode from the slideshow toolbar or by opening `/slideshow?mode=similar`.

Previously a HTTP Range VFS driver was used for Sqlite: however the fallback either didn't work right or a new package version with that feature wasn't released. To make things easier to maintain I switched it back to the official SQLite WASM library.

Sqlite in the browser then loads this database and runs a trigram full-text search. I'm running SQLite on the main thread so it doesn't need access to shared array buffers. SABs need COOP/COEP headers setup. I ran things on the main thread to remove any need for COEP/COOP header hackery (on Vercel, very difficult to debug headers!). This does mean the full database (multi-megabyte) is loaded which can take some time.

<details>
<summary>Details on hack needed to get COOP/COEP headers working back when the range VFS was used:</summary>
Vercel is unable to serve the library's JS files from Next.js's `_next/` build directory with these headers, even with configuration set up in next.config.js and vercel.json. Middleware and API functions cannot redirect or add headers to these files either.

A service worker modified from [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) is used to add headers instead. This works, but has an unfortunate downside of requiring a page reload after initial install.

</details>

---

To take screenshots, visit http://localhost:3000/screenshot.html
