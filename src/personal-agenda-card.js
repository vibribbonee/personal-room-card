/* Personal agenda card: the signed-in person's calendars and to-do list, from one config. */
(() => {
  const BAD = new Set(['unknown', 'unavailable', '']);
  const toList = v => (Array.isArray(v) ? v : v ? [v] : []).map(c => typeof c === 'string' ? {entity: c} : c).filter(c => c && c.entity);

  class PersonalAgendaCard extends HTMLElement {
    constructor() { super(); this._key = ''; this._children = []; this._onMedia = () => this._render(); }
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
    // "Nico's list" / "nico's list" for person "nico"; matched on the friendly name.
    _ownTodo(person) {
      const name = String(person.attributes.friendly_name || '').trim().toLowerCase();
      if (!name) return undefined;
      return Object.values(this._hass.states).find(s => s.entity_id.startsWith('todo.') &&
        new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[’']s (list|to-?do)$`, 'i').test(String(s.attributes.friendly_name || '').trim()))?.entity_id;
    }
    _cards() {
      const c = this._config, h = this._hass, person = this._person();
      let profile = person ? c.people?.[person.entity_id] : undefined;
      const ownList = person && c.auto_todo !== false ? this._ownTodo(person) : undefined;
      // A person with a "<Name>'s list" to-do counts as living here even without a profile.
      if (!profile && ownList) profile = {};
      if (profile && !profile.todo && ownList) profile = {...profile, todo: ownList};
      // People without a profile see nothing unless show_to_everyone is set (guests, kiosks).
      if (!profile && !c.show_to_everyone) return [];
      const parts = c.show || ['calendar', 'todo'];
      const out = [];
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
  if (!customElements.get('personal-agenda-card')) customElements.define('personal-agenda-card', PersonalAgendaCard);
  window.customCards = window.customCards || [];
  if (!window.customCards.some(c => c.type === 'personal-agenda-card'))
    window.customCards.push({type: 'personal-agenda-card', name: 'Personal Agenda', description: 'The signed-in person’s calendars and to-do list: shared calendars plus each person’s own, from one config.'});
})();
