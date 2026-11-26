/* Personal agenda card: the signed-in person's calendars and to-do list, from one config. */
(() => {
  const BAD = new Set(['unknown', 'unavailable', '']);
  const toList = v => (Array.isArray(v) ? v : v ? [v] : []).map(c => typeof c === 'string' ? {entity: c} : c).filter(c => c && c.entity);

  // "Nico's list" / "nico's list" for person "nico"; matched on the friendly name.
  function ownTodo(hass, person) {
    const name = String(person.attributes.friendly_name || '').trim().toLowerCase();
    if (!name) return undefined;
    return Object.values(hass.states).find(s => s.entity_id.startsWith('todo.') &&
      new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[’']s (list|to-?do)$`, 'i').test(String(s.attributes.friendly_name || '').trim()))?.entity_id;
  }

  class PersonalAgendaCard extends HTMLElement {
    constructor() { super(); this._key = ''; this._children = []; this._onMedia = () => this._render(); }
    static getConfigElement() { return document.createElement('personal-agenda-card-editor'); }
    static getStubConfig() { return {type: 'custom:personal-agenda-card', title: 'Upcoming', calendars: [], people: {}}; }
    setConfig(config) {
      if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
      if (config.people && typeof config.people !== 'object') throw new Error('people must map person entities to {calendars, todo}');
      this._config = config;
      this._media?.removeEventListener?.('change', this._onMedia);
      this._media = config.calendar_media ? window.matchMedia(config.calendar_media) : null;
      this._media?.addEventListener?.('change', this._onMedia);
      this._key = '';
      this._render();
    }
    set hass(hass) { this._hass = hass; for (const c of this._children) c.hass = hass; this._render(); }
    getCardSize() { return 4; }
    getGridOptions() { return {columns: 12, rows: 'auto'}; }
    disconnectedCallback() { this._media?.removeEventListener?.('change', this._onMedia); }
    connectedCallback() { if (this._config) { this._media?.addEventListener?.('change', this._onMedia); this._render(); } }

    _person() {
      const h = this._hass;
      return h?.user?.id ? Object.values(h.states).find(s => s.entity_id.startsWith('person.') && s.attributes.user_id === h.user.id) : undefined;
    }
    _ownTodo(person) { return ownTodo(this._hass, person); }
    _cards() {
      const c = this._config, h = this._hass, person = this._person();
      let profile = person ? c.people?.[person.entity_id] : undefined;
      const ownList = person && c.auto_todo !== false ? this._ownTodo(person) : undefined;
      // A person with a "<Name>'s list" to-do counts as living here even without a profile.
      if (!profile && ownList) profile = {};
      if (profile && !profile.todo && ownList) profile = {...profile, todo: ownList};
      // People without a profile see nothing unless show_to_everyone is set (guests, kiosks).
      if (!profile && !c.show_to_everyone) return [];
      const parts = c.show || ['birthdays', 'calendar', 'todo'];
      const out = [];
      if (parts.includes('birthdays') && (!this._media || this._media.matches) && customElements.get('personal-birthday-card'))
        out.push({type: 'custom:personal-birthday-card', ...(c.birthday_card || {})});
      if (parts.includes('calendar') && (!this._media || this._media.matches)) {
        const seen = new Set(), entities = [];
        for (const cal of [...toList(c.calendars), ...toList(profile?.calendars)]) if (!seen.has(cal.entity) && h.states[cal.entity]) { seen.add(cal.entity); entities.push(cal); }
        if (entities.length) {
          const pro = !!customElements.get('calendar-card-pro');
          out.push(pro
            ? {type: 'custom:calendar-card-pro', title: c.title, days_to_show: 30, show_past_events: false, show_empty_days: false, ...(c.calendar_card || {}), entities}
            : {type: 'calendar', title: c.title, initial_view: 'list', entities: entities.map(e => e.entity)});
        }
      }
      if (parts.includes('todo')) {
        for (const todo of [...toList(profile?.todo), ...toList(c.shared_todos)]) {
          const s = h.states[todo.entity];
          if (!s || BAD.has(s.state)) continue;
          if (c.hide_empty_todo !== false && Number(s.state) === 0) continue;
          out.push({type: 'todo-list', title: todo.title ?? c.todo_title ?? 'To do', hide_completed: true, hide_create: true, ...(c.todo_card || {}), entity: todo.entity});
        }
      }
      return out;
    }
    _render() {
      if (!this._hass || !this._config) return;
      const cards = this._cards(), key = JSON.stringify(cards);
      this.style.display = cards.length ? '' : 'none';
      if (key === this._key) return;
      this._key = key;
      if (!cards.length) { this._children = []; this.replaceChildren(); return; }
      window.loadCardHelpers().then(helpers => {
        if (this._key !== key) return;
        this._children = cards.map(cfg => { const el = helpers.createCardElement(cfg); el.hass = this._hass; return el; });
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:var(--ha-section-grid-row-gap, 8px)';
        wrap.append(...this._children);
        this.replaceChildren(wrap);
      });
    }
  }
  // Visual editor. Calendar entries keep any extra options (label, accent_color, …) already set in YAML.
  class PersonalAgendaCardEditor extends HTMLElement {
    constructor() { super(); this.attachShadow({mode: 'open'}); this._forms = []; this._own = false; }
    setConfig(config) { this._config = config; if (this._own) { this._own = false; return; } this._built = false; this._render(); }
    set hass(hass) { this._hass = hass; for (const f of this._forms) f.hass = hass; if (!this._built) this._render(); }
    _emit(next) {
      this._config = next; this._own = true;
      this.dispatchEvent(new CustomEvent('config-changed', {detail: {config: next}, bubbles: true, composed: true}));
    }
    // Map picked entity ids back to their existing objects so per-calendar options survive.
    _merge(ids, previous) {
      const prev = toList(previous);
      return (ids || []).map(id => prev.find(c => c.entity === id) || {entity: id});
    }
    _form(schema, data, labels, onChange) {
      const f = document.createElement('ha-form');
      f.hass = this._hass; f.schema = schema; f.data = data;
      f.computeLabel = field => labels[field.name] || field.name;
      f.addEventListener('value-changed', e => { if (!e.detail.value || typeof e.detail.value !== 'object') return; e.stopPropagation(); f.data = e.detail.value; onChange(e.detail.value); });
      this._forms.push(f);
      return f;
    }
    _render() {
      if (!this._hass || !this._config) return;
      this._built = true; this._forms = [];
      const c = this._config, h = this._hass;
      const root = document.createElement('div');
      const css = document.createElement('style');
      css.textContent = 'h3{margin:20px 0 4px;font-size:16px;font-weight:500}p{margin:0 0 8px;color:var(--secondary-text-color);font-size:13px}.person{border:1px solid var(--divider-color);border-radius:12px;padding:8px 12px 4px;margin:8px 0}.person h4{margin:4px 0;font-weight:500}';
      root.append(css);
      const add = (tag, text) => { const n = document.createElement(tag); n.textContent = text; root.append(n); return n; };

      add('h3', 'General');
      root.append(this._form(
        [
          {name: 'title', selector: {text: {}}},
          {name: 'show', selector: {select: {multiple: true, options: [{value: 'birthdays', label: 'Household birthdays'}, {value: 'calendar', label: 'Calendar'}, {value: 'todo', label: 'To-do list'}]}}},
          {name: 'hide_empty_todo', selector: {boolean: {}}},
          {name: 'show_to_everyone', selector: {boolean: {}}},
          {name: 'auto_todo', selector: {boolean: {}}},
          {name: 'calendar_media', selector: {text: {}}}
        ],
        {title: c.title || '', show: c.show || ['birthdays', 'calendar', 'todo'], hide_empty_todo: c.hide_empty_todo !== false, show_to_everyone: !!c.show_to_everyone, auto_todo: c.auto_todo !== false, calendar_media: c.calendar_media || ''},
        {title: 'Title', show: 'Show', hide_empty_todo: 'Hide a to-do list while it has no open items', show_to_everyone: 'Show shared calendars to people without a profile (guests)', auto_todo: 'Find each person’s “<Name>’s list” automatically', calendar_media: 'Only show birthdays and the calendar on this screen size (CSS media query, optional)'},
        v => {
          const n = {...this._config};
          n.title = v.title || undefined; if (!n.title) delete n.title;
          const show = (v.show || []).filter(Boolean);
          if (show.length && show.length < 3) n.show = show; else delete n.show;
          if (v.hide_empty_todo === false) n.hide_empty_todo = false; else delete n.hide_empty_todo;
          if (v.show_to_everyone) n.show_to_everyone = true; else delete n.show_to_everyone;
          if (v.auto_todo === false) n.auto_todo = false; else delete n.auto_todo;
          if (v.calendar_media) n.calendar_media = v.calendar_media; else delete n.calendar_media;
          this._emit(n);
        }));

      add('h3', 'Shared');
      add('p', 'Everyone with a profile sees these.');
      root.append(this._form(
        [{name: 'calendars', selector: {entity: {domain: 'calendar', multiple: true}}}, {name: 'shared_todos', selector: {entity: {domain: 'todo', multiple: true}}}],
        {calendars: toList(c.calendars).map(x => x.entity), shared_todos: toList(c.shared_todos).map(x => x.entity)},
        {calendars: 'Shared calendars', shared_todos: 'Shared to-do lists (shown while they have items)'},
        v => {
          const n = {...this._config};
          const cals = this._merge(v.calendars, this._config.calendars);
          if (cals.length) n.calendars = cals; else delete n.calendars;
          if (v.shared_todos?.length) n.shared_todos = v.shared_todos; else delete n.shared_todos;
          this._emit(n);
        }));

      add('h3', 'People');
      add('p', 'Each person sees the shared items plus their own. People without a profile see nothing unless their to-do list is found automatically.');
      const persons = Object.values(h.states).filter(st => st.entity_id.startsWith('person.') && st.attributes.user_id)
        .sort((a, b) => (a.attributes.friendly_name || '').localeCompare(b.attributes.friendly_name || ''));
      for (const person of persons) {
        const id = person.entity_id, prof = c.people?.[id] || {};
        const box = document.createElement('div'); box.className = 'person';
        const title = document.createElement('h4'); title.textContent = person.attributes.friendly_name || id; box.append(title);
        const auto = c.auto_todo !== false && !prof.todo ? ownTodo(h, person) : undefined;
        if (auto) { const hint = document.createElement('p'); hint.textContent = `To-do found automatically: ${h.states[auto]?.attributes.friendly_name || auto}`; box.append(hint); }
        box.append(this._form(
          [{name: 'calendars', selector: {entity: {domain: 'calendar', multiple: true}}}, {name: 'todo', selector: {entity: {domain: 'todo'}}}],
          {calendars: toList(prof.calendars).map(x => x.entity), todo: toList(prof.todo)[0]?.entity || ''},
          {calendars: 'Own calendars', todo: auto ? 'To-do list (leave empty to use the one found automatically)' : 'To-do list'},
          v => {
            const n = {...this._config}, people = {...(n.people || {})};
            const p = {...(people[id] || {})};
            const cals = this._merge(v.calendars, p.calendars);
            if (cals.length) p.calendars = cals; else delete p.calendars;
            if (v.todo) p.todo = v.todo; else delete p.todo;
            if (Object.keys(p).length) people[id] = p; else delete people[id];
            if (Object.keys(people).length) n.people = people; else delete n.people;
            this._emit(n);
          }));
        root.append(box);
      }
      add('p', 'Calendar Card Pro and to-do card options (calendar_card, todo_card) and per-calendar label/accent_color are set in YAML.');
      this.shadowRoot.replaceChildren(root);
    }
  }
  if (!customElements.get('personal-agenda-card-editor')) customElements.define('personal-agenda-card-editor', PersonalAgendaCardEditor);
  if (!customElements.get('personal-agenda-card')) customElements.define('personal-agenda-card', PersonalAgendaCard);
  window.customCards = window.customCards || [];
  if (!window.customCards.some(c => c.type === 'personal-agenda-card'))
    window.customCards.push({type: 'personal-agenda-card', name: 'Personal Agenda', description: 'The signed-in person’s calendars and to-do list: shared calendars plus each person’s own, from one config.'});
})();
