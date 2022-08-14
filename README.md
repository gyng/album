# album

[https://album-bice.vercel.app/](https://album-bice.vercel.app/)

Very very rough Next.JS photo album weekend project.

- JSON-defined albums, with editor interface
- EXIF support
- Next.JS static build, deployed on Vercel (due to filesize concerns)
- Custom image optimisation, skipping `next/image`

## Usage

1. Each album is a directory in `public/data/`. Optionally add a `manifest.json` in this directory. If there is no `manifest.json`, a default one is automatically used.
2. Deploy to GHA, or deploy as a normal Next.js app elsewhere.

## Wishlist

- Camera RAW
- Split data from app
- More blocks (Map, video)
- Links
- Local manifest saving
- Themes
- Polish
- Don't optimise all images until export/build-time

## Deploy

Due to the large size of `public/data/*` (and a long time taken to optimise images), deploys are done manually from your (my?) local machine.

```
npm g -i vercel
vercel login
vercel build --prod
vercel deploy --prebuilt --prod
```
