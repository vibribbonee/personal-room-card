# Personal Room Card

Dashboard cards that follow the person who is signed in, instead of showing a fixed room.

One file adds six cards:

| Card | What it shows |
|------|---------------|
| `custom:personal-room-card` | The room you're in right now: its lights, climate and media, readings (temperature, humidity, CO₂, open windows) and suggestions that fit the time of day. |
| `custom:personal-shortcuts-card` | Shortcuts for the current room, learned from what you tap most. |
| `custom:personal-status-pills` | Your devices at a glance: phone, laptop and watch battery, charging and your next alarm. |
| `custom:personal-agenda-card` | Your calendars and to-do list: shared calendars plus your own, from one config instead of a conditional card per person. |
| `custom:personal-birthday-card` | Upcoming birthdays of the people you live with, in their own pronouns: *"It's Edo's birthday today 🎂 He turns 26. Wish him a happy birthday!"* |
| `custom:personal-commute-card` | When to leave for your train, built from Home Assistant's Nederlandse Spoorwegen sensors. |

Nothing is hardcoded. Each card finds "you" from the `person` linked to the signed-in Home Assistant user, so the same dashboard works for everyone in the house.

## How room detection works

The room comes from [Bermuda](https://github.com/agittins/bermuda) Bluetooth tracking of the devices linked to your `person`. To stop it flickering between rooms:

- a new room has to hold for `room_switch_delay` seconds (default 30) before the card switches;
- the last room is kept for `room_loss_grace` seconds (default 90) when tracking drops out;
- the card won't switch while you're tapping it (`interaction_hold`, default 20 s).

Two devices placed in different rooms count as "unsure", not as a vote.

## Away mode

When you're away, the room card stops pretending you're in a room: the header reads **Away · Home** (your Home Assistant location name, or `away_title`), and instead of one room's controls it lists **every room that has controls**, each with how many things are on there (*Bedroom · 2 on*). Rooms open their `rooms.<area>.path`, or `rooms_path`. Set `away_rooms: false` to show `fallback_cards` instead.

When you're home but the card can't place you yet, it shows your `fallback_area` as *Your space · probably*.

## Who else is home

The card knows who else lives in the house: every `person` linked to a login with at least one tracker. Kiosk or tablet logins can be left out with `household_exclude`, or you can list people explicitly with `household`.

- **At home**, the subtitle says who else is in and where, e.g. *byte in Kitchen* or *byte here too* (with a 🎂 on their birthday).
- **Away, and someone else is home**, the card says *byte is home · 3 things on*. Whatever is running is theirs, so it isn't offered for switching off.
- **Away, and nobody else is home**, you get the **Still on at home** list: lights, fans, media and climate that are still running, as tiles you can tap to switch off, with an **All off** button (asks first). When nothing is running it says *Everything's off at home*.

Someone whose tracker can't say where they are counts as unknown, never as away. The card says so ("Can't tell if byte is home") and the All off confirmation warns you.

What counts as running: lights and fans that are on, media that is on or playing (paused doesn't count), and climate that isn't off. Light groups and the screens of voice/kiosk devices (an Echo Show or smart clock backlight) are skipped; add anything else to `still_on_exclude`.

| Option | Default | |
|---|---|---|
| `show_household` | `true` | Who else is home |
| `household_exclude` | `[]` | People to leave out, e.g. a kiosk login |
| `household` | all with a login and a tracker | Explicit list of people |
| `show_still_on` | `true` | The away view |
| `show_all_off` | `true` | The All off button |
| `still_on_limit` | `8` | Tiles shown before "…and N more" |
| `still_on_exclude` | `[]` | Entities to never list |

## Personal agenda

List the calendars everyone shares once, then each person's own calendars and to-do list. The card shows the signed-in person's combined agenda, and their to-do list only while it has open items.

```yaml
type: custom:personal-agenda-card
title: Upcoming
calendars:                      # shared: everyone with a profile sees these
  - {entity: calendar.holidays, label: "📅", accent_color: green}
  - {entity: calendar.family, label: "👪", accent_color: blue}
people:
  person.alex:
    calendars:
      - {entity: calendar.alex_work, label: "💼", accent_color: red}
    todo: todo.alex_s_list
  person.sam:
    todo: todo.sam_s_list
show: [calendar, todo]          # or just one part
calendar_media: "(min-width: 768px)"   # optional: only show birthdays and the calendar on this screen size
calendar_card:                  # passed straight to calendar-card-pro
  compact_events_to_show: 3
```

Each person's own to-do list is found automatically when it's called *"<Name>'s list"* (matching their `person` name), so a new housemate needs no config at all; `todo:` overrides it and `auto_todo: false` turns the lookup off. `shared_todos` lists to-dos everyone sees while they have open items, e.g. `shared_todos: [todo.shopping_list]`.

Everything above can be set from the card's visual editor: the shared calendars and lists, and a block per person for their own calendars and to-do list. Labels and colours you set in YAML are kept when you change calendars in the editor.

Calendar entries take [Calendar Card Pro](https://github.com/alexpfau/calendar-card-pro) options (`label`, `accent_color`, …). Without Calendar Card Pro installed, it falls back to Home Assistant's built-in calendar card. People without a profile (a guest login, a kiosk) see nothing unless you set `show_to_everyone: true`, in which case they get the shared calendars. Set `hide_empty_todo: false` to always show the to-do list.

## Birthdays

`custom:personal-birthday-card` reads two attributes from each `person`:

- `birthday`: day-month with an optional year, e.g. `16-02-2001` or `06-04` (ISO `2001-02-16` works too; set `date_order: MDY` for month-first dates).
- pronouns: `pronoun1`/`pronoun2`/`pronoun3` (subject/object/possessive, e.g. `he`/`him`/`his`) or a single `pronouns: they/them`.

It shows birthdays coming up within `days_ahead` (default 14): *today*, *tomorrow*, or the date, with the age when a year is known. Pronouns pick the right words (*they turn*, *he turns*, *wish them*). Someone without pronouns is referred to by name; the card never guesses. On your own birthday it greets you instead (`show_own: false` to turn that off), and it hides when nothing is coming up.

People without a login can be added:

```yaml
type: custom:personal-birthday-card
days_ahead: 21
extra:
  - {name: Grandma, birthday: 03-05, pronouns: she/her}
```

The agenda card shows it on top of the calendar (part `birthdays`); `birthday_card:` passes options through.

Person attributes like these can be added with Home Assistant's `homeassistant: customize:` in `configuration.yaml`.

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

All options can be set from the visual editor, including the household and away settings.

## Development

The two cards live in `src/`. Run `./build.sh` to rebuild `dist/personal-room-card.js`.
