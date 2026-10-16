# Canada's Wonderland rides — parent directory MVP

**Status: LOCKED 2026-09-13** (Justin skipped tweak; use as-is). Source of truth with `directory.json` for Builder Bot.

Purpose: **Can my kid ride this / will they get wet / which area?** — not ride-porn.

## Identity
- `name`, `park_area`, `official_url`

## Type
- `ride_type` (from research)
- `ride_type_coarse`: coaster | water | kids | flat | thrill | dark_ride | boat | other

## Height (primary parent filter)
- `min_in`, `max_in`
- `supervised_companion_rule`
- `other_restrictions`

## Practical
- `gets_wet` (true/false/null)
- `water_notes`
- `thrill_level_published` (often blank)

## Coaster facts (when present; may be RCDB)
- drop, length, speed, inversions, duration

## Map (overlay later)
- `lat`, `lng` — null until Research Bot provides per-ride coords
- `map_url`, `coords_source`, `coords_confidence` — optional when known
- Never invent coordinates; soft-pause OK

## Meta
- `confidence`, `sources`, `gaps_notes`, `accessibility_notes`

## Rules
- Never invent missing fields
- Soft-pause with intentional gaps OK
- Prefer Google Sheet once linked; CSV is bootstrap
