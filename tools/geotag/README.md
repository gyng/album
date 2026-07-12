# Tagging workbench

Local companion app for writing location and manual-lens metadata into album photos. It operates on original files, so it only listens on localhost and ExifTool retains a `<file>_original` backup for every edited image.

## Run

```sh
cd tools/geotag
npm install
npm run dev
```

Open the Vite URL printed in the terminal. The browser starts at the repository root; set `GEOTAG_START_DIR=/path/to/photos` to open somewhere else by default.

## Workflows

- **Location:** select photos, paste coordinates or click the map, or load a GPX/Google Takeout track and interpolate by capture time. Review pending markers before writing.
- **Manual lens:** create reusable presets containing maker, model, focal length, and optional 35 mm equivalent. Use **Select all without lens** then apply a preset, or use a preset's **All missing** action for a single-lens batch. Presets stay in this browser.

Assignments are only staged until the blue **Write** button is confirmed. After writing, run `index/do-retag.sh` from the repository root to refresh the search database.

The tool deliberately does not preset aperture for a manual lens: the shooting aperture can differ from frame to frame.

## Verify

```sh
npm test
npm run typecheck
npm run build
```
