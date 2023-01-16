# album

[Demo](https://album-gyng.vercel.app/)

| Index                                                                                                         | Album                                                                                                         | Edit                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| ![Index](https://user-images.githubusercontent.com/370496/209406151-e13ef6fc-eb25-41a0-a7d3-293bc69d9c09.png) | ![Album](https://user-images.githubusercontent.com/370496/209406166-e47e6a0e-abda-4b47-8856-862424fd3966.png) | ![Edit mode](https://user-images.githubusercontent.com/370496/209406238-be8a6a82-eb64-4455-a4a5-7e70eba7c15f.png) |

A zero-config static album generator

- Dump your photos in a directory and run one command to deploy
- Optionally, create JSON-defined albums, with editor interface in development mode
- EXIF support
- Next.JS static build, deployed on Vercel
- Custom image optimisation, resizing

Constraints

- Minimal friction between camera and publishing on web
- EXIF and GPS data
- Photos are size-optimised for mobile viewing

This is a weekend project! Very, very, rough Next.JS project.

## Usage

You will need Node installed. The following steps are for deployment on Vercel, but you can deploy elsewhere &mdash; this is a standard Next.js application.

0. Clone the repo and then log in to Vercel
   ```
   $ git clone https://github.com/gyng/album.git
   $ cd album/src/public/data/albums
   ```

1. Add your photos in a directory! Each album is a directory in `src/public/data/albums`.
   ```
   /src
   └─public
     └─data
       └─albums
         ├─my-album
         │ ├─pic1.jpg
         │ └─pic2.jpg
         └─my-album-with-manifest
           ├─manifest.json
           └─pic.jpg
   ```
   Optionally, add a `manifest.json` in this directory to add annotations basic layout, and other text. If there is no `manifest.json`, a default one is automatically used. See [/src/public/data/albums](/src/public/data/albums) for examples.

2. Deploy on Vercel (or elsewhere).

   Due to the large size of `public/data/*` (and a long time taken to optimise images), deploys are done manually from your (my?) local machine. Image optimisations/resizes are cached locally on `next build` or `vercel build`, so clear out `.resized_images` first if you want to regenerate them. If Next.js times out during `vercel build`, it's probably image optimisation taking way too long. In that case, run `npm run build` to optimise images first.

   ```
   $ npm g -i vercel
   $ vercel login
   $ vercel build --prod
   $ vercel deploy --prebuilt --prod
   ```
  
3. To use the manifest creator, run `npm run dev` or `yarn dev` and visit your album's page. Click the `Edit` link at the top.

## Wishlist

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
