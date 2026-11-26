/* Personal birthday card: upcoming birthdays of the people you live with, in their own pronouns. */
(() => {
  // Pronouns from person attributes: pronoun1/2/3 (subject/object/possessive) or "pronouns: he/him".
  // Unknown pronouns fall back to the person's name, never to a guess.
  const DETERMINER = {theirs: 'their', his: 'his', hers: 'her', its: 'its', their: 'their', her: 'her'};
  function pronounsOf(attrs = {}, name) {
    let [subject, object, possessive] = [attrs.pronoun1, attrs.pronoun2, attrs.pronoun3];
    if (!subject && typeof attrs.pronouns === 'string') {
      const parts = attrs.pronouns.split('/').map(p => p.trim().toLowerCase()).filter(Boolean);
      subject = parts[0]; object = parts[1];
      possessive = {they: 'their', he: 'his', she: 'her', it: 'its'}[subject];
    }
    subject = subject?.toLowerCase(); object = object?.toLowerCase(); possessive = possessive?.toLowerCase();
    if (!subject) return {known: false, subject: name, object: name, determiner: `${name}'s`, plural: false};
    return {known: true, subject, object: object || name, determiner: DETERMINER[possessive] || possessive?.replace(/s$/, '') || `${name}'s`, plural: subject === 'they'};
  }
  // "06-01-1999", "06-04" (day-month, optionally year) or "1999-01-06" (ISO).
  function parseBirthday(value, order = 'DMY') {
    const s = String(value || '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return {year: +m[1], month: +m[2], day: +m[3]};
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{4}))?$/);
    if (!m) return null;
    const [a, b] = [+m[1], +m[2]];
    const [day, month] = order === 'MDY' ? [b, a] : [a, b];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return {year: m[3] ? +m[3] : null, month, day};
  }
  const verb = (p, singular, plural) => (p.plural ? plural : singular);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  class PersonalBirthdayCard extends HTMLElement {
    constructor() { super(); this.attachShadow({mode: 'open'}); this._key = ''; }
    static getConfigElement() { return document.createElement('personal-birthday-card-editor'); }
    static getStubConfig() { return {type: 'custom:personal-birthday-card', days_ahead: 14}; }
    setConfig(config) { this._config = config || {}; this._key = ''; this._render(); }
    set hass(hass) { this._hass = hass; this._render(); }
    getCardSize() { return 2; }
    getGridOptions() { return {columns: 12, rows: 'auto'}; }
    connectedCallback() { clearInterval(this._t); this._t = setInterval(() => { this._key = ''; this._render(); }, 600000); }
    disconnectedCallback() { clearInterval(this._t); }

    _today() {
      const now = this._now ? new Date(this._now) : new Date();
      const tz = this._hass?.config?.time_zone;
      const parts = new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now);
      const get = t => +parts.find(p => p.type === t).value;
      return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
    }
    upcoming() {
      const h = this._hass, c = this._config, today = this._today();
      const exclude = new Set(c.exclude || []), ahead = Math.max(0, Number(c.days_ahead ?? 14));
      const me = h.user?.id ? Object.values(h.states).find(s => s.entity_id.startsWith('person.') && s.attributes.user_id === h.user.id) : undefined;
      const people = Object.values(h.states).filter(s => s.entity_id.startsWith('person.') && s.attributes.birthday && !exclude.has(s.entity_id))
        .map(s => ({entity: s.entity_id, name: s.attributes.friendly_name || s.entity_id.split('.')[1], attrs: s.attributes, birthday: s.attributes.birthday}));
      for (const x of c.extra || []) if (x?.name && x?.birthday) people.push({entity: null, name: x.name, attrs: {pronouns: x.pronouns}, birthday: x.birthday});
      const out = [];
      for (const p of people) {
        const b = parseBirthday(p.birthday, c.date_order);
        if (!b) continue;
        let next = new Date(Date.UTC(today.getUTCFullYear(), b.month - 1, b.day));
        if (next < today) next = new Date(Date.UTC(today.getUTCFullYear() + 1, b.month - 1, b.day));
        const days = Math.round((next - today) / 86400000);
        if (days > ahead) continue;
        out.push({...p, days, date: next, age: b.year ? next.getUTCFullYear() - b.year : null, mine: !!me && p.entity === me.entity_id, pro: pronounsOf(p.attrs, p.name)});
      }
      return out.filter(p => !p.mine || this._config.show_own !== false).sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
    }
    _line(p) {
      const pr = p.pro, h = this._hass;
      const when = p.days === 0 ? 'today' : p.days === 1 ? 'tomorrow' : `on ${new Intl.DateTimeFormat(h.locale?.language || h.language || 'en-GB', {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'}).format(p.date)}`;
      const age = p.age ? ` ${cap(pr.known ? pr.subject : p.name)} ${p.days === 0 ? verb(pr, 'turns', 'turn') : verb(pr, 'turns', 'turn')} ${p.age}.` : '';
      if (p.mine) return {emoji: '🎉', title: p.days === 0 ? `Happy birthday, ${p.name}!` : `Your birthday is ${when}`, text: p.days === 0 ? 'Have a lovely day.' : p.days === 1 ? 'Almost there!' : `${p.days} days to go.`};
      if (p.days === 0) return {emoji: '🎂', title: `It's ${p.name}'s birthday today`, text: `${age.trim()} Wish ${pr.object} a happy birthday!`.trim()};
      if (p.days === 1) return {emoji: '🎁', title: `${p.name}'s birthday is tomorrow`, text: `${age.trim()} Still time to sort out something for ${pr.object}.`.trim()};
      return {emoji: '🗓️', title: `${p.name}'s birthday is ${when}`, text: `In ${p.days} days.${age}`};
    }
    _render() {
      if (!this._hass || !this._config) return;
      const list = this.upcoming(), key = JSON.stringify(list.map(p => [p.entity || p.name, p.days, p.age]));
      this.style.display = list.length ? '' : 'none';
      if (key === this._key) return;
      this._key = key;
      if (!list.length) { this.shadowRoot.replaceChildren(); return; }
      const card = document.createElement('ha-card');
      const style = document.createElement('style');
      style.textContent = ':host{display:block}ha-card{padding:14px 16px}.title{font-size:var(--ha-font-size-l,16px);font-weight:500;margin:0 0 6px}.row{display:flex;gap:12px;align-items:flex-start;padding:6px 0}.row+.row{border-top:1px solid var(--divider-color)}.emoji{font-size:24px;line-height:1.2}.what{font-weight:500}.more{color:var(--secondary-text-color);font-size:13px;margin-top:2px}.today .what{color:var(--primary-color)}';
      if (this._config.title) { const t = document.createElement('div'); t.className = 'title'; t.textContent = this._config.title; card.append(t); }
      for (const p of list) {
        const l = this._line(p), row = document.createElement('div');
        row.className = 'row' + (p.days === 0 ? ' today' : '');
        const e = document.createElement('div'); e.className = 'emoji'; e.textContent = l.emoji; e.setAttribute('aria-hidden', 'true');
        const body = document.createElement('div');
        const w = document.createElement('div'); w.className = 'what'; w.textContent = l.title;
        const m = document.createElement('div'); m.className = 'more'; m.textContent = l.text;
        body.append(w, m); row.append(e, body); card.append(row);
      }
      this.shadowRoot.replaceChildren(style, card);
    }
  }

  class PersonalBirthdayCardEditor extends HTMLElement {
    constructor() { super(); this.attachShadow({mode: 'open'}); }
    setConfig(config) { this._config = config; if (this._own) { this._own = false; return; } this._build(); }
    set hass(hass) { this._hass = hass; if (this._form) this._form.hass = hass; else this._build(); }
    _build() {
      if (!this._hass || !this._config) return;
      const c = this._config, f = document.createElement('ha-form');
      f.hass = this._hass;
      f.schema = [
        {name: 'title', selector: {text: {}}},
        {name: 'days_ahead', selector: {number: {min: 0, max: 60, mode: 'box', unit_of_measurement: 'days'}}},
        {name: 'show_own', selector: {boolean: {}}},
        {name: 'exclude', selector: {entity: {domain: 'person', multiple: true}}}
      ];
      const labels = {title: 'Title (optional)', days_ahead: 'Show birthdays coming up within', show_own: 'Also greet people on their own birthday', exclude: 'Leave these people out'};
      f.computeLabel = x => labels[x.name] || x.name;
      f.data = {title: c.title || '', days_ahead: c.days_ahead ?? 14, show_own: c.show_own !== false, exclude: c.exclude || []};
      f.addEventListener('value-changed', e => {
        const v = e.detail.value; if (!v) return; e.stopPropagation(); f.data = v;
        const n = {...this._config};
        if (v.title) n.title = v.title; else delete n.title;
        n.days_ahead = v.days_ahead ?? 14;
        if (v.show_own === false) n.show_own = false; else delete n.show_own;
        if (v.exclude?.length) n.exclude = v.exclude; else delete n.exclude;
        this._config = n; this._own = true;
        this.dispatchEvent(new CustomEvent('config-changed', {detail: {config: n}, bubbles: true, composed: true}));
      });
      const hint = document.createElement('p');
      hint.style.cssText = 'color:var(--secondary-text-color);font-size:13px';
      hint.textContent = 'Reads each person’s birthday (day-month, optional year, e.g. 16-02-2001) and pronouns (pronoun1/2/3 or “pronouns: he/him”) attributes. Extra people without a login can be added in YAML under extra.';
      this._form = f;
      this.shadowRoot.replaceChildren(f, hint);
    }
  }

  if (!customElements.get('personal-birthday-card')) customElements.define('personal-birthday-card', PersonalBirthdayCard);
  if (!customElements.get('personal-birthday-card-editor')) customElements.define('personal-birthday-card-editor', PersonalBirthdayCardEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some(c => c.type === 'personal-birthday-card'))
    window.customCards.push({type: 'personal-birthday-card', name: 'Personal Birthdays', description: 'Upcoming birthdays of the people you live with, in their own pronouns.'});
})();
