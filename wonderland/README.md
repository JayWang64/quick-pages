# Canada's Wonderland Rides — Parent Directory

Mobile-first parent directory for Canada's Wonderland rides. Answer the parent questions: **Can my kid ride this? Will they get wet? Which park area?**

## Preview

Start a local server:

```bash
# Using Python
python3 -m http.server 8080

# Or using npx serve
npx serve -l 8080
```

Then open [http://localhost:8080/index.html](http://localhost:8080/index.html)

### Geolocation Note

The "My Location" map feature requires a **secure context** (HTTPS or localhost). Plain HTTP on LAN IPs like `http://100.x.x.x` or `http://*.ts.net` will fail on iPhone Safari and most modern browsers.

For HTTPS testing locally:
```bash
# Using mkcert for local HTTPS
mkcert -install
mkcert localhost
npx serve -l 8080 --ssl-cert localhost.pem --ssl-key localhost-key.pem
```

## Features

- **79 rides** from official park data (2026)
- **Height filter** — enter your kid's height or use quick picks (36"/42"/48"/54"/60")
  - Shows eligibility: ✓ eligible, with adult, or too short/tall
  - Accounts for supervised companion rules
- **Gets wet filter** — yes, no, or unknown
- **Park area filter** — Action Zone, Alpenfest, Frontier Canada, Grande World Expo, KidZville, Medieval Faire, Planet Snoopy, Splash Works
- **Ride type filter** — Coaster, Water, Kids, Flat, Thrill, Dark Ride, Boat
- **Interactive map** — Leaflet/OSM with semi-transparent overlay hit targets; click to view ride details in popup
- **Two-finger rotate** — twist to change map bearing (like Google Maps); compass control to reset to north
- **My Location** — blue-dot with accuracy circle (like Apple/Google Maps); tap control button to pan to your position
- **Walking directions** — tap "Walk here" on any ride to get turn-by-turn walking route
  - Routes computed entirely client-side using A* algorithm on OSM path data
  - No API keys or external services required
  - Shows distance and estimated walking time (~80 m/min)
  - Bold green polyline with white casing for high visibility
  - If inside the park, uses your current location as start point
  - If outside, lets you choose: main entrance or another ride
  - Fallback dashed line when no path exists
- **Coaster stats** — speed, drop, track length, inversions, duration (when available)
- **Direct links** — official ride pages + Google Maps

## Data

Ride data in `public/rides.json` (locked schema). Coordinates from OpenStreetMap.

### Walk Graph

The walking path network is in `public/walkgraph.json`, built from OpenStreetMap data using `scripts/build-walkgraph.mjs`.

To rebuild the walk graph (e.g., after OSM edits):

```bash
# Fetch fresh OSM data and rebuild
node scripts/build-walkgraph.mjs --fetch
```

The graph includes:
- 4,790 nodes, 5,541 edges
- ~248 KB file size
- 78/79 rides within 60m of a path node (Leviathan is 88m due to sparse OSM data)
- Fully connected (A* can route between any two points)

### Routing Tests

Run the routing quality tests:

```bash
node scripts/test-routing.mjs
```

This verifies:
- Routes exist between well-known ride pairs
- Route lengths are reasonable (≤2.5x straight-line distance)
- All rides snap to the graph within 60m

## Status

**Draft** — not for production deploy.
