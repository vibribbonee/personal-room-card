# Personal Room Card

Dashboard cards that follow the person who is signed in, instead of showing a fixed room.

One file adds four cards:

| Card | What it shows |
|------|---------------|
| `custom:personal-room-card` | The room you're in right now: its lights, climate and media, readings (temperature, humidity, CO₂, open windows) and suggestions that fit the time of day. |
| `custom:personal-shortcuts-card` | Shortcuts for the current room, learned from what you tap most. |
| `custom:personal-status-pills` | Your devices at a glance: phone, laptop and watch battery, charging and your next alarm. |
| `custom:personal-commute-card` | When to leave for your train, built from Home Assistant's Nederlandse Spoorwegen sensors. |

Nothing is hardcoded. Each card finds "you" from the `person` linked to the signed-in Home Assistant user, so the same dashboard works for everyone in the house.

## How room detection works

The room comes from [Bermuda](https://github.com/agittins/bermuda) Bluetooth tracking of the devices linked to your `person`. To stop it flickering between rooms:

- a new room has to hold for `room_switch_delay` seconds (default 30) before the card switches;
- the last room is kept for `room_loss_grace` seconds (default 90) when tracking drops out;
- the card won't switch while you're tapping it (`interaction_hold`, default 20 s).

Two devices placed in different rooms count as "unsure", not as a vote.

## When you're away

When your `person` is away, the room card shows your `fallback_area` plus a **Still on at home** list: lights, fans, media players and climate that are still running, as tiles you can tap to switch off. When nothing is running it says *Everything's off at home*. Set `show_still_on: false` to hide it, or `still_on_limit` (default 8) to change how many it lists. Light groups are skipped so a whole-house group doesn't repeat its members. You can always pick a room by hand; that choice is stored in the browser only, never in Home Assistant.

## Install

**Marketplace:** add this repository as a custom repository (type *Dashboard*), install it, and reload the browser.

**Manual:** copy `dist/personal-room-card.js` to `/config/www/` and add `/local/personal-room-card.js` as a JavaScript module under **Settings → Dashboards → Resources**.

The room card's readings row uses [Mushroom](https://github.com/piitaya/lovelace-mushroom) chips.

## Example

```yaml
type: custom:personal-room-card
storage_id: home
show_suggestions: true
learn_shortcuts: true
show_room_picker: false
fallback_area: bedroom      # shown when you're away or no room is detected
rooms:
  bedroom:
    readings:
      window: binary_sensor.bedroom_window   # shown as a chip while open
    shortcuts: []           # pinned shortcuts for this room, optional
```

All options can be set from the visual editor.

## Development

The two cards live in `src/`. Run `./build.sh` to rebuild `dist/personal-room-card.js`.
