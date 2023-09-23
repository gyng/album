# album

[Demo](https://album-gyng.vercel.app/)

| Index                                                                                                         | Album                                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ![Index](https://user-images.githubusercontent.com/370496/209406151-e13ef6fc-eb25-41a0-a7d3-293bc69d9c09.png) | ![Album](https://user-images.githubusercontent.com/370496/209406166-e47e6a0e-abda-4b47-8856-862424fd3966.png) |

A zero-config static album generator

- Dump your photos in a directory and run one command to deploy
- Index and search images using YOLOv8/ImageNet classifications
- EXIF support
- Next.JS static build, deployed on Vercel
- Custom image optimisation, resizing

Constraints

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
   /src
   └─public
     └─data
       └─albums
   +     ├─my-album
   +     │ ├─pic1.jpg
   +     │ └─cover.pic2.jpg
         └─my-album-with-manifest
           ├─album.json
           └─pic.jpg
   ```

   Include `cover` in the filename to set it as the album cover on the index page. The first photo is otherwise used by default.

   ### Album configuration

   Optionally, add an `album.json` to the album directory to do album-level configuration.

   ```ts
   {
      // Defaults to oldest-first
      sort?: "newest-first" | "oldest-first"
   }
   ```

   <details>
   <summary>v1 manifest (deprecated)</summary>
   V1 manifest is overly difficult to use and will be removed.

   Optionally, add a `manifest.json` in this directory to add annotations, basic layout, and other text. If there is no `manifest.json`, a default one is automatically used.

   Manifest creation mode is only enabled in local (`npm run dev`). Copy the manifest output from this mode into the album's directory as `manifest.json`. See [/src/public/data/albums](/src/public/data/albums) for examples.
   </details>

2. Deploy on Vercel (or elsewhere).

   Due to the large size of `public/data/*` (and a long time taken to optimise images), deploys are done manually from your (my?) local machine. Image optimisations/resizes are cached locally on `next build` or `vercel build`, so clear out `.resized_images` first if you want to regenerate them. If Next.js times out during `vercel build`, it's probably image optimisation taking way too long. In that case, run `npm run build` to optimise images first.

   ```
   $ npx vercel@latest login
   $ npx vercel@latest build --prod
   $ npx vercel@latest deploy --prebuilt --prod
   ```

   If the build fails, try removing `.vercel` and reinitialising the project. Somehow this seems to happen a lot.

3. Index images by running the script at `/index/index.py` amd copying the result to `/src/public`. You need CUDA installed: see [index/README.md](index/README.md)

   ```sh
   $ cd index
   $ poetry install
   $ poetry run python index.py index --glob "../src/public/data/albums/**/*.jpg" --dbpath "search.sqlite"
   $ cp search.sqlite ../src/public/search.sqlite
   ```

4. To use the manifest creator, run `npm run dev` or `yarn dev` and visit your album's page. Click the `Edit` link at the top.

Be sure to configure your license for _all_ images in `src/License.tsx`. By default all photos are licensed under CC BY-NC 4.0.

## Wishlist

- EXIF stripping via filename
- Camera RAW
- Split data from app
- Automatic external storage
- Better content-based caching
- More blocks (Map, video)
- Links
- Local manifest saving
- Themes
- Polish
- Don't optimise all images until export/build-time

## Privacy notes

Analytics is integrated into the app at `_app.tsx`. Remove the `<Analytics />` component to remove any analytics. See [Next.js docs on analytics](https://vercel.com/docs/concepts/analytics) for more details.
