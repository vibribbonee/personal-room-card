/* Personal Room. Self-contained HA custom cards; no network dependencies. */
(() => {
  const CARD_VERSION = '1.0.0';
  if (!window.__personalRoomCardLogged) {
    window.__personalRoomCardLogged = true;
    console.info(`%c PERSONAL-ROOM-CARD %c ${CARD_VERSION} `, 'color:#fff;background:#3b82f6;font-weight:700', 'color:#3b82f6;background:#fff');
  }
  const BAD = new Set(['unknown', 'unavailable', 'not_home', '']);
  const CONTROL_DOMAINS = new Set(['light', 'climate', 'media_player', 'fan', 'cover']);
  const ROOM_CONTEXTS = new Map();
  const ROOM_TIMINGS = new Map();
  const stateOK = s => s && !BAD.has(s.state);
  const ROOM_READING_SLOTS = [
    {name:'temperature', label:'Temperature', domain:'sensor', deviceClass:'temperature', icon:'mdi:thermometer'},
    {name:'humidity', label:'Humidity', domain:'sensor', deviceClass:'humidity', icon:'mdi:water-percent'},
    {name:'carbon_dioxide', label:'CO₂', domain:'sensor', deviceClass:'carbon_dioxide', icon:'mdi:molecule-co2'},
    {name:'window', label:'Window contacts', domain:'binary_sensor', deviceClass:'window'}
  ];
  function readingEntities(value) {
    const values = Array.isArray(value) ? value : [value];
    return [...new Set(values.filter(entity => typeof entity === 'string' && entity.length > 0))];
  }
  function roomReadingsCard(readings) {
    const chips = [];
    for (const slot of ROOM_READING_SLOTS.filter(slot => slot.name === 'window')) {
      const entities = readingEntities(readings?.[slot.name]);
      const isWindow = slot.name === 'window';
      for (const entity of entities) {
        const chip = {type:'entity',entity,tap_action:{action:'more-info'}};
        if (isWindow) {
          Object.assign(chip,{icon:'mdi:window-open-variant',icon_color:'amber',content_info:'name'});
          if (entities.length === 1) chip.name = 'Window open';
        }
        const conditions = isWindow ? [{entity,state:'on'}] :
          ['unknown','unavailable'].map(state_not => ({entity,state_not}));
        chips.push({type:'conditional',conditions,chip});
      }
    }
    return chips.length ? {type:'custom:mushroom-chips-card',alignment:'start',chips} : null;
  }
  const timingSeconds = (value,fallback,max) => {if(value===undefined || value===null || value==='' || typeof value==='boolean')return fallback;const n=Number(value);return Number.isFinite(n)?Math.round(Math.max(0,Math.min(max,n))):fallback;};
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const matchesRule = (rule,h,person,room) => (!rule.users || rule.users.includes(h.user?.id)) && (!rule.persons || rule.persons.includes(person?.entity_id)) && (!rule.areas || rule.areas.includes(room));

  // Room/shortcut cards can share smoothing on this page, isolated by user and context.
  // No current-room value is written to an HA helper or shared with another device.
  class RoomStability {
    constructor(dwell = 30000, grace = 90000, interaction = 20000) { this.dwell = dwell; this.grace = grace; this.interaction=interaction; this.room = null; this.candidate = null; this.since = 0; this.lastSeen = 0; this.touched = -Infinity; }
    touch(now) { this.touched = now; }
    update(raw, now, manual, connected = true) {
      if (manual) return manual;
      if (raw && connected) {
        if (raw !== this.candidate) { this.candidate = raw; this.since = now; }
        if (raw === this.room) this.lastSeen = now;
        // The dwell stops flicker *between* rooms. With no room yet (arriving, first load)
        // there is nothing to flicker from, so a short confirmation is enough.
        const dwell = this.room ? this.dwell : Math.min(this.dwell, 5000);
        if (now - this.since >= dwell && now - this.touched >= this.interaction) { this.room = raw; this.lastSeen = now; }
      } else { this.candidate = null; this.since = now; }
      if ((!raw || !connected) && now - this.lastSeen > this.grace && now - this.touched >= this.interaction) this.room = null;
      return this.room;
    }
  }

  class PersonalRoomCard extends HTMLElement {
    constructor() {
      super(); this.attachShadow({mode:'open'}); this._stability = new RoomStability(); this._children = []; this._manual = null; this._usage = []; this._uiKey = ''; this._suggestKey = ''; this._busy = false;
      this.shadowRoot.addEventListener('pointerdown', () => this._stability.touch(Date.now()), true);
      this.shadowRoot.addEventListener('keydown', () => this._stability.touch(Date.now()), true);
      this.shadowRoot.addEventListener('focusin', () => this._stability.touch(Date.now()), true);
      this._visibility = () => {
        if (!document.hidden) { this._stability.candidate = null; this._stability.since = Date.now(); this._render(); }
      };
    }
    static getConfigElement() { return document.createElement('personal-room-card-editor'); }
    static getStubConfig() { return {type:'custom:personal-room-card',stabilize_room:true,hold_last_room:true,pause_on_interaction:true,show_suggestions:true,learn_shortcuts:true,show_room_picker:false,show_room_navigation:false}; }
    _timingKey() {return `personal-room:v1:${location.origin}:${this._hass?.user?.id || 'anonymous'}:${this._config?.storage_id || 'wip'}`;}
    _newStability() {
      if(this._config?.mode==='shortcuts' && this._config.follow_room_timing!==false) {const shared=ROOM_TIMINGS.get(this._timingKey());if(shared)return new RoomStability(...shared);}
      return new RoomStability(this._config?.stabilize_room===false?0:timingSeconds(this._config?.room_switch_delay,30,300)*1000,this._config?.hold_last_room===false?0:timingSeconds(this._config?.room_loss_grace,90,600)*1000,this._config?.pause_on_interaction===false?0:timingSeconds(this._config?.interaction_hold,20,120)*1000);
    }
    setConfig(config) { this._config = config;this._contextKey=null;this._stability=this._newStability(); this._uiKey = ''; this._suggestKey = ''; this._render(); }
    set hass(hass) { this._hass = hass; this._render(); }
    getCardSize() { return 12; }
    getGridOptions() { return {columns:12, rows:'auto', min_columns:6}; }
    connectedCallback() {
      clearInterval(this._timer); this._timer = setInterval(() => { if (!document.hidden) this._render(); }, 1000);
      document.addEventListener('visibilitychange', this._visibility);
      this._render();
    }
    disconnectedCallback() { clearInterval(this._timer); document.removeEventListener('visibilitychange', this._visibility); }
    _identity() {
      const h = this._hass;
      const person = h.user?.id ? Object.values(h.states).find(s => s.entity_id.startsWith('person.') && s.attributes.user_id === h.user.id) : undefined;
      const key = `personal-room:v1:${location.origin}:${h.user?.id || 'anonymous'}:${this._config.storage_id || 'wip'}`;
      const timing=this._newStability();
      if(this._config.mode!=='shortcuts' && !this.preview)ROOM_TIMINGS.set(key,[timing.dwell,timing.grace,timing.interaction]);
      const contextKey=key+JSON.stringify([!!this.preview,timing.dwell,timing.grace,timing.interaction,this._config.fixed_area || '',this._config.fallback_area || '']);
      if (key !== this._storageKey || contextKey!==this._contextKey) {
        this._storageKey = key; this._contextKey=contextKey;this._uiKey = ''; this._suggestKey = '';
        try { this._manual = JSON.parse(localStorage.getItem(key) || '{}').room || null; } catch { this._manual = null; }
        if(!ROOM_CONTEXTS.has(contextKey)) {const stability=this._newStability();stability.manual=this._manual;ROOM_CONTEXTS.set(contextKey,stability);}
        this._stability=ROOM_CONTEXTS.get(contextKey);
        try { this._usage = JSON.parse(localStorage.getItem(key + ':usage') || '[]'); if (!Array.isArray(this._usage)) this._usage = []; } catch { this._usage = []; }
      }
      this._manual=this._stability.manual;
      return person;
    }
    _resolveRoom(person, detected, manual) {
      const away=!!person && !['home','unknown','unavailable',''].includes(person.state);
      const fallback=this._config.fallback_area && this._hass.areas?.[this._config.fallback_area] ? this._config.fallback_area : null;
      const useFallback=!manual && !!fallback && (away || !detected);
      return {room:manual || (useFallback?fallback:detected),fallback:useFallback,away};
    }
    _track(person) {
      const h = this._hass, trackers = person?.attributes.device_trackers || [];
      const devices = new Set(trackers.map(id => h.entities?.[id]?.device_id).filter(Boolean));
      const sensors = Object.values(h.states).filter(s => s.entity_id.startsWith('sensor.') && s.attributes.device_class === 'bermuda__custom_device_class' && devices.has(h.entities?.[s.entity_id]?.device_id));
      const ids = [...new Set(sensors.filter(stateOK).map(s => s.attributes.area_id).filter(id => h.areas?.[id]))];
      // Multiple associated BLE devices in different rooms are ambiguous, not a vote.
      const raw=ids.length === 1 && h.connected !== false ? ids[0] : null;
      const ages=sensors.filter(s=>stateOK(s) && s.attributes.area_id===raw).map(s=>Date.now()-Date.parse(s.last_changed)).filter(Number.isFinite);
      return {raw, devices, sensors, ambiguous: ids.length > 1,stableFor:ages.length?Math.min(...ages):0};
    }
    _areaEntities(area) {
      const h = this._hass;
      return Object.values(h.entities || {}).filter(e => (e.area_id || h.devices?.[e.device_id]?.area_id) === area && !e.hidden && !e.entity_category && CONTROL_DOMAINS.has(e.entity_id.split('.')[0]) && h.states[e.entity_id]).sort((a,b) => a.entity_id.localeCompare(b.entity_id));
    }
    // Other people who live here: persons linked to a login with at least one tracker,
    // minus household_exclude (kiosk/tablet logins). `known` is false while their
    // tracker can't say, which is never treated as "not home".
    _household(me) {
      const h=this._hass, exclude=new Set(this._config.household_exclude || []);
      const listed=this._config.household;
      return Object.values(h.states)
        .filter(s=>s.entity_id.startsWith('person.') && s.entity_id!==me?.entity_id && !exclude.has(s.entity_id))
        .filter(s=>listed ? listed.includes(s.entity_id) : s.attributes.user_id && (s.attributes.device_trackers || []).length)
        .map(s=>{
          const home=s.state==='home', known=!BAD.has(s.state) || s.state==='not_home';
          const area=home ? this._track(s).raw : null;
          const name=(s.attributes.friendly_name || s.entity_id.split('.')[1])+(this._birthdayToday(s.attributes.birthday)?' 🎂':'');
          return {entity:s.entity_id,name,home,known,room:area ? h.areas?.[area]?.name : null};
        });
    }
    // Birthday attribute is day-month with an optional year ("16-02-2001", "06-04").
    _birthdayToday(value) {
      const m=String(value || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.]\d{4})?$/);
      if(!m)return false;
      const order=this._config.date_order==='MDY', day=+(order?m[2]:m[1]), month=+(order?m[1]:m[2]);
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:this._hass?.config?.time_zone,month:'numeric',day:'numeric'}).formatToParts(new Date());
      return +parts.find(p=>p.type==='day').value===day && +parts.find(p=>p.type==='month').value===month;
    }
    _names(list) { const n=list.map(p=>p.name); return n.length<3 ? n.join(' and ') : `${n.slice(0,-1).join(', ')} and ${n.at(-1)}`; }
    // One shortcut per room that has controls, with how many things are running there.
    _roomLinks() {
      const h=this._hass, running=new Set(this._stillOn());
      const areaOf=id=>{const e=h.entities?.[id];return e?.area_id || h.devices?.[e?.device_id]?.area_id;};
      return this._rooms().filter(a=>this._areaEntities(a.area_id).length).map(a=>{
        const on=[...running].filter(id=>areaOf(id)===a.area_id).length;
        const path=this._config.rooms?.[a.area_id]?.path || this._config.rooms_path || '/lovelace/rooms';
        return {type:'shortcut',label:`${a.name}${on?` · ${on} on`:''}`,icon:a.icon || 'mdi:door-open',tap_action:{action:'navigate',navigation_path:path}};
      });
    }
    // Lights, fans, media and climate that are still running, for the away view.
    // Groups are skipped so a whole-house light group doesn't repeat its members.
    _stillOn() {
      const h=this._hass;
      const running=s=>{const d=s.entity_id.split('.')[0];return d==='media_player'?['on','playing','buffering'].includes(s.state):d==='climate'?!['off',...BAD].includes(s.state):s.state==='on';};
      const exclude=new Set(this._config.still_on_exclude || []);
      // A "light" on a voice/kiosk device (e.g. an Echo Show or smart-clock screen) is its
      // display backlight, which is meant to stay on, not a room light someone forgot.
      const kiosk=new Set(Object.values(h.entities || {}).filter(e=>e.entity_id.startsWith('assist_satellite.') && e.device_id).map(e=>e.device_id));
      return Object.values(h.entities || {})
        .filter(e=>['light','fan','media_player','climate'].includes(e.entity_id.split('.')[0]) && !e.hidden && !e.entity_category && !exclude.has(e.entity_id))
        .filter(e=>!(e.entity_id.startsWith('light.') && kiosk.has(e.device_id)))
        .map(e=>h.states[e.entity_id]).filter(s=>s && running(s) && !Array.isArray(s.attributes.entity_id))
        .sort((a,b)=>(a.attributes.friendly_name || a.entity_id).localeCompare(b.attributes.friendly_name || b.entity_id))
        .map(s=>s.entity_id);
    }
    _rooms() {
      const configured = this._config.rooms || {};
      return Object.values(this._hass.areas || {}).filter(a => configured[a.area_id] || this._areaEntities(a.area_id).length).sort((a,b) => a.name.localeCompare(b.name));
    }
    _saveRoom(value) {
      this._manual = value || null;
      this._stability.manual=this._manual;
      try { localStorage.setItem(this._storageKey, JSON.stringify({room:this._manual})); } catch {}
      this._stability.touch(Date.now()); this._render();
    }
    _more(entityId) { this.dispatchEvent(new CustomEvent('hass-more-info', {detail:{entityId}, bubbles:true, composed:true})); }
    _navigate(path) { history.pushState(null, '', path); window.dispatchEvent(new Event('location-changed')); }
    _clock() {
      try { return Number(new Intl.DateTimeFormat('en-GB', {timeZone:this._hass.config.time_zone, hour:'numeric', hourCycle:'h23'}).format(new Date())); } catch { return new Date().getHours(); }
    }
    _timeContext(at=Date.now()) {
      const parts=new Intl.DateTimeFormat('en-GB',{timeZone:this._hass?.config?.time_zone || 'Europe/Amsterdam',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at));
      const get=type=>parts.find(p=>p.type===type)?.value;
      const hour=Number(get('hour')),weekday=get('weekday');
      return {hour,weekday,date:[get('year'),get('month'),get('day')].join('-'),weekend:['Sat','Sun'].includes(weekday),part:hour>=5&&hour<11?'morning':hour<15&&hour>=11?'afternoon':hour>=15&&hour<18?'late afternoon':hour>=18&&hour<23?'evening':'night'};
    }
    _habitScore(id,room) {
      const now=Date.now(),context=this._timeContext(),days=new Map();
      for(const use of this._usage) {
        if(use.id!==id || use.room!==room || !Number.isFinite(use.at) || now-use.at>90*86400000 || use.at>now)continue;
        const old=this._timeContext(use.at);
        const hourDistance=Math.min(Math.abs(old.hour-context.hour),24-Math.abs(old.hour-context.hour));
        const relevance=old.part===context.part?1:hourDistance<=1?0.5:0;
        const weekdayWeight=old.weekday===context.weekday?1.5:old.weekend===context.weekend?1:0.35;
        const score=relevance*weekdayWeight*Math.exp(-(now-use.at)/(30*86400000));
        // Repeated taps in one session cannot dominate a weekday's ranking.
        days.set(old.date,Math.max(days.get(old.date)||0,score));
      }
      return {score:[...days.values()].reduce((a,b)=>a+b,0),days:[...days.values()].filter(v=>v>0).length};
    }
    _remember(id, room) {
      if(this._config.learn_shortcuts===false) return;
      const now = Date.now(); this._usage = this._usage.filter(x => now - x.at < 90 * 86400000);
      this._usage.push({id,room,...this._timeContext(now),at:now}); this._usage = this._usage.slice(-500);
      try { localStorage.setItem(this._storageKey + ':usage', JSON.stringify(this._usage)); } catch {}
    }
    _comfortSuggestions(room, fallback=false) {
      const h=this._hass, cfg=this._config.temperature_suggestions?.[room];
      const person=h.user?.id?Object.values(h.states).find(s=>s.entity_id.startsWith('person.') && s.attributes.user_id===h.user.id):null;
      if(!cfg?.enabled || person?.state!=='home' || (fallback && !cfg.allow_home_fallback))return [];
      const sensor=h.states[cfg.temperature_entity];
      if(!stateOK(sensor) || String(sensor.state).trim()==='' || !Number.isFinite(Number(sensor.state)))return [];
      const number=(v,d)=>v!=='' && v!=null && Number.isFinite(Number(v))?Number(v):d;
      const temperature=Number(sensor.state),cold=number(cfg.cold_below,19),warm=number(cfg.warm_above,25);
      if(cold>=warm)return [];
      this._comfortState ||= new Map();
      const key=`${h.user.id}:${room}`,previous=this._comfortState.get(key);
      const band=temperature<cold || (previous==='cold' && temperature<cold+0.5)?'cold':temperature>warm || (previous==='warm' && temperature>warm-0.5)?'warm':'neutral';
      this._comfortState.set(key,band);
      const heater=h.states[cfg.heater_entity],fan=h.states[cfg.fan_entity];
      const windows = readingEntities([
        ...readingEntities(cfg.window_entity),
        ...readingEntities(this._config.rooms?.[room]?.readings?.window)
      ]);
      const windowClosed = windows.every(entity => h.states[entity]?.state === 'off');
      const choices=[];
      const target=Math.min(number(heater?.attributes.max_temp,30),Math.max(number(heater?.attributes.min_temp,5),number(cfg.target_temperature,20)));
      if(band==='cold' && windowClosed && stateOK(heater) && heater.attributes.hvac_modes?.includes('heat') && target>temperature && !(heater.state==='heat' && number(heater.attributes.temperature,-Infinity)>=target)) {
        choices.push({id:'comfort_heat',name:`Warm room to ${target} °C`,icon:'mdi:radiator',entity:cfg.heater_entity,domain:'climate',service:'set_temperature',data:{temperature:target,hvac_mode:'heat'},base:18,contextual:true,context_reason:`Room is below ${cold} °C. ${windows.length > 1 ? 'The configured windows are closed. ' : windows.length === 1 ? 'The window is closed. ' : ''}Tap to heat to ${target} °C.`});
      }
      if(band==='warm' && stateOK(heater) && heater.state==='heat')choices.push({id:'comfort_heater_off',name:'Room is warm · heater off',icon:'mdi:radiator-off',entity:cfg.heater_entity,domain:'climate',service:'set_hvac_mode',data:{hvac_mode:'off'},base:19,contextual:true,context_reason:`Room is above ${warm} °C. Tap to turn the heater off.`});
      if(band==='warm' && stateOK(fan))choices.push({id:'comfort_fan',name:'Cool the room · fan',icon:'mdi:fan',entity:cfg.fan_entity,more_info:true,base:17,contextual:true,context_reason:`Room is above ${warm} °C. Open fan controls.`});
      return choices;
    }
    _shortcutRelevant(shortcut, night) {
      const state = this._hass.states[shortcut.entity];
      if (shortcut.entity && !stateOK(state)) return false;
      if (shortcut.only_evening && !night) return false;
      if (shortcut.id === 'blanket' && state?.state === 'on') return false;
      if (shortcut.id === 'dim') {
        const target = Number(shortcut.data?.brightness_pct ?? 25);
        const brightness = Number(state?.attributes.brightness);
        return night && state?.state === 'on' && Number.isFinite(brightness) &&
          brightness > (target + 10) * 2.55;
      }
      return true;
    }
    _suggestions(room, fallback=false) {
      const h = this._hass, hour = this._clock(), night = hour >= 20 || hour < 5, activeFocus = h.states['timer.timer_focus_session']?.state === 'active';
      const choices = [...(fallback ? this._config.fallback_shortcuts || [] : this._config.rooms?.[room]?.shortcuts || []),...this._comfortSuggestions(room,fallback)].filter(c => this._shortcutRelevant(c, night));
      const scored = choices.map(c => {
        let score = c.base || 0;
        if (c.id === 'focus') score += activeFocus ? 10 : hour >= 9 && hour < 20 ? 3 : 0;
        if (c.id === 'blanket') score += night ? 5 : 0;
        if (c.id === 'dim') score += night ? 4 : 0;
        if (c.id === 'tv') score += ['playing','paused'].includes(h.states[c.entity]?.state) ? 6 : hour >= 18 ? 2 : 0;
        const learned = this._config.learn_shortcuts===false?{score:0,days:0}:this._habitScore(c.id,room);
        return {...c,score:score+Math.min(8,learned.score*2),learned:learned.days >= 3};
      });
      return scored.sort((a,b) => b.score-a.score || a.id.localeCompare(b.id)).slice(0,3);
    }
    async _run(c, room) {
      if (this._busy) return;
      const hour = this._clock();
      if (!this._shortcutRelevant(c, hour >= 20 || hour < 5)) {
        this._message.textContent = 'Conditions changed. Choose from the current suggestions.';
        this._suggestKey = '';
        this._render();
        return;
      }
      if(c.contextual){const fresh=this._comfortSuggestions(room,false).find(x=>x.id===c.id);if(!fresh){this._message.textContent='Room conditions changed. Check the room controls.';return;}c=fresh;}
      if (c.confirm && !window.confirm(c.confirm)) return;
      this._busy = true; this._stability.touch(Date.now());
      try {
        if (c.path) this._navigate(c.path);
        else if (c.more_info) this._more(c.entity);
        else if (c.domain && c.service) await this._hass.callService(c.domain,c.service,{...(c.data || {}), ...(c.entity ? {entity_id:c.entity} : {})});
        this._remember(c.id,room); this._message.textContent = c.path || c.more_info ? '' : 'Done';
      } catch (e) { this._message.textContent = e.message || 'Could not run that command'; }
      finally { this._busy = false; }
    }
    _renderReadings(readings) {
      const items = [];
      for (const slot of ROOM_READING_SLOTS.filter(slot => slot.name !== 'window')) {
        for (const entity of readingEntities(readings?.[slot.name])) {
          const state = this._hass.states[entity];
          if (!stateOK(state) || !String(state.state).trim()) continue;
          const value = Number(state.state);
          if (!Number.isFinite(value)) continue;
          const formatted = new Intl.NumberFormat(this._hass.locale?.language || this._hass.language || 'en', {
            maximumFractionDigits: slot.name === 'temperature' ? 1 : 0
          }).format(value);
          const unit = state.attributes?.unit_of_measurement || (slot.name === 'temperature' ? this._hass.config?.unit_system?.temperature || '°C' : slot.name === 'humidity' ? '%' : 'ppm');
          const text = formatted + (unit === '%' || unit.startsWith('°') ? '' : ' ') + unit;
          const warning = Number(readings?.carbon_dioxide_warning ?? 1000);
          const high = Number(readings?.carbon_dioxide_high ?? 2000);
          const warningAt = Number.isFinite(warning) && warning >= 400 ? warning : 1000;
          const highAt = Math.max(warningAt,Number.isFinite(high) && high >= 400 ? high : 2000);
          const severity = slot.name === 'carbon_dioxide' && unit.toLowerCase() === 'ppm' ? value >= highAt ? 'high' : value >= warningAt ? 'warning' : '' : '';
          const icon = severity === 'high' ? 'mdi:alert-octagon' : severity === 'warning' ? 'mdi:alert-outline' : slot.icon;
          const advice = severity === 'high' ? '. High CO₂. Ventilate the room' : severity === 'warning' ? '. Elevated CO₂. Consider fresh air' : '';
          items.push({row:slot.name === 'carbon_dioxide' ? 'co2' : 'comfort',entity, text, icon, severity, title:slot.label + ': ' + text + advice});
        }
      }
      for (const [root,group] of [
        [this._comfortReadings,items.filter(item => item.row === 'comfort')],
        [this._readings,items.filter(item => item.row === 'co2')]
      ]) {
        const key = JSON.stringify(group);
        root.hidden = !group.length;
        if (key === root._readingsKey) continue;
        root._readingsKey = key;
        root.replaceChildren();
        group.forEach((item,index) => {
          if (index) {
            const separator = el('span','·','reading-separator');
            separator.setAttribute('aria-hidden','true');
            root.append(separator);
          }
          const button = el('button',undefined,'reading' + (item.severity ? ' reading-' + item.severity : ''));
          const icon = el('ha-icon');
          icon.setAttribute('icon',item.icon);
          icon.setAttribute('aria-hidden','true');
          button.append(icon,el('span',item.text));
          button.type = 'button';
          button.title = item.title;
          button.setAttribute('aria-label',item.title + '. Show details');
          button.addEventListener('click',() => this._more(item.entity));
          root.append(button);
        });
      }
    }
    _build() {
      this.shadowRoot.innerHTML = `<style>
        :host{display:block;color:var(--primary-text-color);container-type:inline-size}ha-card{padding:20px;overflow:hidden;background:var(--ha-card-background,var(--card-background-color));border-radius:var(--ha-card-border-radius,20px)}
        .eyebrow{font-size:12px;letter-spacing:.11em;text-transform:uppercase;color:var(--secondary-text-color);margin-bottom:6px}.title{margin:0;font-size:clamp(20px,6.5cqi,26px);font-weight:600;line-height:1.2;min-width:0}.sub{color:var(--secondary-text-color);font-size:13px;line-height:1.5;margin:6px 0 12px}
        .picker{display:flex;align-items:center;gap:8px;margin-bottom:14px}.picker label{flex:1;min-width:0}select,button{font:inherit;color:var(--primary-text-color);background:var(--secondary-background-color);border:1px solid var(--divider-color);border-radius:14px;min-height:44px}select{width:100%;padding:10px;cursor:pointer}button{cursor:pointer;padding:10px 12px;text-align:left}button:hover{background:var(--ha-color-fill-neutral-normal-resting,var(--secondary-background-color));border-color:var(--primary-color)}button:focus-visible,select:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}button:disabled{opacity:.45;cursor:wait}.auto{white-space:nowrap}.auto[aria-pressed=true]{color:var(--primary-color);border-color:var(--primary-color)}
        .status{font-size:12px;min-height:34px;line-height:1.4;color:var(--secondary-text-color);margin:0 0 12px}.controls{min-height:340px;display:flex;flex-direction:column;gap:10px}.empty{padding:24px 4px;line-height:1.6;color:var(--secondary-text-color)}.controls>*{display:block}.short-title{font-size:16px;font-weight:600;margin:20px 0 6px}.caption{font-size:12px;line-height:1.5;color:var(--secondary-text-color);margin:0 0 10px}.suggestions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;min-height:84px}.suggestions button{font-size:12px;line-height:1.35;padding:10px 8px;display:flex;flex-direction:column;gap:7px;align-items:flex-start}.suggestions ha-icon{color:var(--primary-color);--mdc-icon-size:22px}.room-link{margin-top:14px;width:100%;text-align:center;background:transparent}.message{min-height:16px;font-size:12px;margin-top:8px;color:var(--secondary-text-color)}
      .room-heading{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;align-items:center;margin-bottom:12px}.room-heading .eyebrow{grid-column:1;grid-row:1;margin:0}.room-heading .title{grid-column:1;grid-row:2}.room-heading .sub{grid-column:1;grid-row:3;margin:0}.room-comfort{grid-column:2;grid-row:2}.room-carbon{grid-column:2;grid-row:3}.room-comfort .reading,.room-carbon .reading{min-height:20px}.room-readings{display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-left:auto;max-width:100%;color:var(--secondary-text-color);font-size:12px;font-variant-numeric:tabular-nums}.room-readings[hidden]{display:none}.room-readings .reading{display:inline-flex;align-items:center;gap:3px;font:inherit;color:inherit;background:transparent;border:0;border-radius:0;min-height:32px;padding:0;white-space:nowrap}.room-readings ha-icon{--mdc-icon-size:14px;width:14px;height:14px}.room-readings .reading.reading-warning,.room-readings .reading.reading-warning:hover{color:var(--warning-color,#ff9800);font-weight:650}.room-readings .reading.reading-high,.room-readings .reading.reading-high:hover{color:var(--error-color,#db4437);font-weight:650}.room-readings .reading:hover{color:var(--primary-text-color);text-decoration:underline}.room-readings .reading:focus-visible{outline:2px solid var(--primary-color);outline-offset:3px}.reading-separator{opacity:.55}
      </style><ha-card><div class="room-heading"><div class="eyebrow">Your space</div><h2 class="title"></h2><div class="room-readings room-comfort" role="group" aria-label="Room temperature and humidity" hidden></div><div class="sub"></div><div class="room-readings room-carbon" role="group" aria-label="Room CO₂" hidden></div></div><div class="picker"><label><select aria-label="Room selection"></select></label><button class="auto" aria-pressed="true">Auto</button></div><div class="status" role="status" aria-live="polite"></div><div class="controls"></div><div class="short-title">Useful now</div><p class="caption">Time-based suggestions. Learns from shortcuts you use on this device.</p><div class="suggestions"></div><button class="room-link">Browse rooms</button><div class="message" role="status"></div></ha-card>`;
      const q = s => this.shadowRoot.querySelector(s);
      this._title=q('.title'); this._readings=q('.room-carbon'); this._comfortReadings=q('.room-comfort'); this._sub=q('.sub'); this._select=q('select'); this._status=q('.status'); this._controls=q('.controls'); this._suggest=q('.suggestions'); this._message=q('.message');
      this._pin=el('button','Pin','auto');this._pin.setAttribute('aria-label','Pin room on this device');q('.picker').append(this._pin);
      this._pin.addEventListener('click',()=>{ if(this._currentRoom) this._saveRoom(this._currentRoom); });
      this._select.addEventListener('change',e => this._saveRoom(e.target.value));
      q('.auto').addEventListener('click',() => this._saveRoom(null));
      q('.room-link').addEventListener('click',() => this._navigate(this._config.rooms_path || '/lovelace/rooms'));
    }
    _render() {
      if (!this._hass || !this._config || !this.isConnected) return;
      const h = this._hass, person = this._identity(), track = this._track(person), now = Date.now();
      if (!this._controls) this._build();
      const shortcutsOnly=this._config.mode==='shortcuts';
      this.style.display=shortcutsOnly && this._config.show_suggestions===false?'none':'block';
      for(const selector of ['.room-heading','.sub','.controls']) this.shadowRoot.querySelector(selector).style.display=shortcutsOnly?'none':'';
      this.shadowRoot.querySelector('.short-title').style.marginTop=shortcutsOnly?'0':'20px';
      this.shadowRoot.querySelector('.picker').hidden=!this._config.show_room_picker;
      this.shadowRoot.querySelector('.picker').style.display=!shortcutsOnly && this._config.show_room_picker?'flex':'none';
      this.shadowRoot.querySelector('.room-link').style.display=!shortcutsOnly && this._config.show_room_navigation?'block':'none';
      for(const selector of ['.short-title','.caption','.suggestions']) this.shadowRoot.querySelector(selector).style.display=this._config.show_suggestions===false || this._hasSuggestions===false?'none':'';
      this.shadowRoot.querySelector('.caption').textContent=this._config.learn_shortcuts===false?'Suggested for this time of day.':'Suggestions adapt to the weekday and time of day from shortcuts you use on this device.';
      const rooms=this._rooms();
      if (this._manual && !h.areas?.[this._manual] && rooms.length) this._saveRoom(null);
      const manual=this._config.fixed_area || (this._config.show_room_picker?this._manual:null);
      const raw=this._config.require_home && person?.state!=='home'?null:track.raw;
      // The server knows how long the room signal has been steady. If it has already held for
      // the dwell time, don't make this page wait again (first load, or the app resuming from
      // the background, where the local timer was paused or reset).
      if(raw && raw!==this._stability.room && track.stableFor>=this._stability.dwell && this._stability.since>now-this._stability.dwell) {this._stability.candidate=raw;this._stability.since=now-this._stability.dwell;}
      const detected=this._stability.update(raw,now,manual,h.connected !== false);
      const resolved=this._resolveRoom(person,detected,manual), room=resolved.room, usingFallback=resolved.fallback, name=h.areas?.[room]?.name;
      this.shadowRoot.querySelector('.caption').textContent=(shortcutsOnly && name?name+' · ':'')+(usingFallback?'Default room shortcuts':this._config.temperature_suggestions?.[room]?.enabled?'Suggestions follow room conditions, weekday and time of day.':this._config.learn_shortcuts===false?'Suggested for this time of day.':'Suggestions adapt to the weekday and time of day from shortcuts you use on this device.');
      this._currentRoom=room;
      this._pin.disabled=!room; this._pin.textContent=this._manual?'Pinned':'Pin';this._pin.setAttribute('aria-pressed',String(!!this._manual));
      const displayName=person?.attributes.friendly_name || h.user?.name || 'Home';
      const awayView=usingFallback && resolved.away;
      this.shadowRoot.querySelector('.eyebrow').textContent=awayView?'Away':usingFallback?'Your space · probably':'Your space';
      this._title.textContent = awayView ? (this._config.away_title || h.config?.location_name || 'Home') : name || `Hello, ${displayName}`;
      const household=this._config.show_household===false ? [] : this._household(person);
      const othersHome=household.filter(p=>p.home);
      let company='';
      if(othersHome.length && !resolved.away) {
        const here=othersHome.filter(p=>p.room && p.room===name), elsewhere=othersHome.filter(p=>!(p.room && p.room===name));
        company=[here.length?`${this._names(here)} here too`:'',elsewhere.length?elsewhere.map(p=>p.room?`${p.name} in ${p.room}`:`${p.name} home`).join(', '):''].filter(Boolean).join(' · ');
      }
      this._sub.textContent = `${displayName}${usingFallback?resolved.away?'':' · Room not detected yet':this._config.fixed_area?' · Room for this display':manual?' · Pinned on this device':''}${company?' · '+company:''}`;
      const listKey=rooms.map(a=>a.area_id+':'+a.name).join('|');
      if (listKey !== this._listKey) {
        this._listKey=listKey; this._select.replaceChildren(); const opt=el('option','Choose a room');opt.value='';this._select.append(opt);
        for (const a of rooms) { const o=el('option',a.name);o.value=a.area_id;this._select.append(o); }
      }
      if (this.shadowRoot.activeElement !== this._select) this._select.value=room || '';
      this.shadowRoot.querySelector('.auto').setAttribute('aria-pressed',String(!this._manual));
      let status = this._config.show_room_picker?'No room signal yet. Choose a room to pin its controls here.':'No room signal yet. Open a room from the top navigation.';
      if (h.connected === false) status = 'Home Assistant is disconnected. Displayed controls may be out of date.';
      else if(usingFallback) status=resolved.away?'Room status and remote controls while you are away.':'Showing your default room until a stable room location is available.';
      else if (this._config.fixed_area) status='Fixed room for this display.';
      else if (manual) status = 'Pinned. Moving rooms will not change these controls. Tap Auto to follow again.';
      else if (track.ambiguous) status = 'Your tracking devices disagree. Keeping the last room briefly.';
      else if (raw && raw !== room) status = `Checking ${h.areas[raw].name}… waiting for a steady signal.`;
      else if (room && !raw) status = 'Room signal paused. Keeping the last room briefly.';
      else if (room) status = `Automatic${this._config.stabilize_room===false?'':` · waits ${this._stability.dwell/1000}s before switching`}${this._config.pause_on_interaction===false?'':' · pauses while you use controls'}`;
      else if (!person) status = 'Your login is not linked to a person yet. Open a room from the top navigation.';
      else if (!track.sensors.length) status = 'No room tracker linked to your person yet. Open a room from the top navigation.';
      this._status.textContent=status;
      this._status.style.display=shortcutsOnly || (usingFallback && !this._config.show_tracking_details) || (room && raw===room && !manual && !this._config.show_tracking_details)?'none':'';
      const configured=this._config.rooms?.[room];
      this._renderReadings(usingFallback || shortcutsOnly ? null : configured?.readings);
      let cards=awayView && this._config.away_rooms!==false ? this._roomLinks() : usingFallback && this._config.fallback_cards ? this._config.fallback_cards : configured?.cards || (room && this._config.auto_area_controls!==false ? this._areaEntities(room).slice(0,6).map(e=>({type:'tile',entity:e.entity_id})) : []);
      for(const rule of this._config.card_rules || []) {
        if (matchesRule(rule,h,person,room)) cards=rule.replace ? [...(rule.cards || [])] : [...cards,...(rule.cards || [])];
      }
      if(this._config.hide_unavailable)cards=cards.filter(c=>!c.entity || stateOK(h.states[c.entity]));
      const groupTitle=awayView?null:usingFallback?this._config.fallback_title:configured?.title;
      if(groupTitle)cards=[{type:'heading',heading:groupTitle,heading_style:'subtitle'},...cards];
      if(usingFallback && resolved.away && this._config.show_still_on!==false) {
        const stillOn=this._stillOn(), limit=Math.max(1,Number(this._config.still_on_limit) || 8);
        const unsure=household.filter(p=>!p.known);
        const things=n=>`${n} thing${n===1?'':'s'} on`;
        if(othersHome.length) {
          // Someone else is home: what's on is theirs, so report it without offering to switch it off.
          cards=[{type:'heading',heading:`${this._names(othersHome)} ${othersHome.length===1?'is':'are'} home${stillOn.length?' · '+things(stillOn.length):''}`,heading_style:'subtitle',icon:'mdi:account-group-outline'},...cards];
        } else if(stillOn.length) {
          const heading={type:'heading',heading:'Still on at home',heading_style:'subtitle',icon:'mdi:home-lightning-bolt-outline'};
          if(this._config.show_all_off!==false) heading.badges=[{type:'button',icon:'mdi:power',text:'All off',tap_action:{action:'perform-action',perform_action:'homeassistant.turn_off',target:{entity_id:stillOn},confirmation:{text:`Turn off ${things(stillOn.length).replace(' on','')} at home?${unsure.length?` ${this._names(unsure)}'s location is unknown.`:''}`}}}];
          const tiles=stillOn.slice(0,limit).map(entity=>({type:'tile',entity}));
          if(stillOn.length>limit) tiles.push({type:'markdown',text_only:true,content:`…and ${stillOn.length-limit} more`});
          cards=[heading,...tiles,...cards];
        } else {
          cards=[{type:'heading',heading:"Everything's off at home",heading_style:'subtitle',icon:'mdi:home-check-outline'},...cards];
        }
        if(unsure.length && !othersHome.length) cards.splice(1,0,{type:'markdown',text_only:true,content:`<small>Can't tell if ${this._names(unsure)} ${unsure.length===1?'is':'are'} home.</small>`});
      }
      const readings = usingFallback ? null : roomReadingsCard(configured?.readings);
      if(readings) cards = [readings,...cards];
      if(shortcutsOnly)cards=[];
      const uiKey=JSON.stringify([room,cards]);
      if (uiKey !== this._uiKey) {
        this._uiKey=uiKey; this._children=[]; this._controls.replaceChildren();
        if (!cards.length) this._controls.append(el('div',room ? 'No controls are assigned to this room yet.' : 'Your room controls will appear here when your room is detected. You can open a room from the top navigation at any time.','empty'));
        else {
          this._controls.append(el('div','Loading controls…','empty'));
          const version=uiKey;
          Promise.resolve().then(()=>window.loadCardHelpers()).then(helpers=> {
            if (this._uiKey !== version || !this.isConnected) return;
            this._children=cards.map(c=> {const card=helpers.createCardElement(c);card.hass=this._hass;return card;});
            this._controls.replaceChildren(...this._children);
          }).catch(()=> { if(this._uiKey===version) { const b=el('button','Open room controls');b.addEventListener('click',()=>this._navigate(configured?.path || this._config.rooms_path));this._controls.replaceChildren(b); } });
        }
      }
      for (const c of this._children) c.hass=h;
      // Refresh when a condition changes; keep button positions steady during interaction.
      const comfortKey=this._comfortSuggestions(room,usingFallback).map(c=>c.id+':'+c.name).join('|');
      const shortcuts = usingFallback ? this._config.fallback_shortcuts || [] : configured?.shortcuts || [];
      const shortcutStates = JSON.stringify(shortcuts.map(shortcut => {
        const state = h.states[shortcut.entity];
        return [shortcut.id,state?.state,state?.attributes.brightness];
      }));
      const suggestContext=`${room}:${usingFallback}`,suggestKey=`${suggestContext}:${this._clock()}:${comfortKey}:${shortcutStates}`;
      if (suggestKey !== this._suggestKey && (this._suggestRoom !== suggestContext || this._suggestKey === '' || now-this._stability.touched >= this._stability.interaction)) {
        this._suggestRoom=suggestContext;
        this._suggestKey=suggestKey; this._suggest.replaceChildren();
        const choices=this._suggestions(room,usingFallback);
        this._hasSuggestions=choices.length>0;
        for(const selector of ['.short-title','.caption','.suggestions']) this.shadowRoot.querySelector(selector).style.display=this._config.show_suggestions===false || !this._hasSuggestions?'none':'';
        for (const c of choices) {const b=el('button');const icon=el('ha-icon');icon.setAttribute('icon',c.icon || 'mdi:gesture-tap-button');b.append(icon,el('span',c.name));b.title=c.context_reason || (c.learned?'Used on several days around this time on this device':'Suggested for this time');b.addEventListener('click',()=>this._run(c,room));this._suggest.append(b);}
        if (!choices.length) {for(const selector of ['.short-title','.caption','.suggestions']) this.shadowRoot.querySelector(selector).style.display='none';}
      }
    }
  }
  class PersonalRoomEditor extends HTMLElement {
    constructor() {super();this.attachShadow({mode:'open'});}
    setConfig(config) {this._config=config;this._render();}
    set hass(hass) {this._hass=hass;for(const editor of this._editors || [])editor.hass=hass;if(this._roomPreview)this._roomPreview.hass=hass;if(this._temperatureForm)this._temperatureForm.hass=hass;if(this._readingsForm)this._readingsForm.hass=hass;if(this._householdForm)this._householdForm.hass=hass;this._render();}
    set lovelace(value) {this._lovelace=value;for(const editor of this._editors || [])editor.lovelace=value;}
    _change(key,value) {this._config={...this._config,[key]:value};this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this._config},bubbles:true,composed:true}));}
    _editorKey() {return JSON.stringify([this._config,Object.values(this._hass?.areas || {}).map(a=>[a.area_id,a.name]),this._selectedRoom]);}
    _roomCardsChanged(target,stack) {
      if(!Array.isArray(stack.cards))return;
      if(target==='__fallback__')this._config={...this._config,fallback_cards:stack.cards,fallback_title:stack.title || ''};
      else this._config={...this._config,rooms:{...this._config.rooms,[target]:{...this._config.rooms?.[target],cards:stack.cards,title:stack.title || ''}}};
      this._updateRoomPreview();
      // Keep the nested native editor mounted as fields are typed.
      this._key=this._editorKey();
      this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this._config},bubbles:true,composed:true}));
    }
    _previewConfig() {
      const fallback=this._selectedRoom==='__fallback__',room=this._config.rooms?.[this._selectedRoom];
      const cards=fallback?this._config.fallback_cards:room?.cards;
      const title=fallback?this._config.fallback_title:room?.title;
      const readings = fallback ? null : roomReadingsCard(room?.readings);
      return {type:'vertical-stack',cards:readings ? [readings,...(cards || [])] : cards || [],...(title?{title}:{})};
    }
    async _updateRoomPreview() {
      const host=this._previewHost;if(!host)return;
      const version=this._previewVersion=(this._previewVersion || 0)+1;
      const config=this._previewConfig();
      if(!config.cards.length) {this._roomPreview=null;host.replaceChildren(el('p','No cards yet. Use + below to add the first one.'));return;}
      try {
        const helpers=await window.loadCardHelpers();
        if(version!==this._previewVersion || !host.isConnected)return;
        const card=helpers.createCardElement(config);card.preview=true;card.hass=this._hass;
        this._roomPreview=card;host.replaceChildren(card);
      } catch {if(version===this._previewVersion)host.replaceChildren(el('p','Preview unavailable. Your card configuration is preserved.'));}
    }
    async _mountCards(host,target) {
      try {
        const helpers=await window.loadCardHelpers();
        const card=helpers.createCardElement({type:'vertical-stack',cards:[]});
        const editor=await card.constructor.getConfigElement();
        if(!host.isConnected)return;
        const room=this._config.rooms?.[target];
        const cards=target==='__fallback__'?this._config.fallback_cards:room?.cards;
        const title=target==='__fallback__'?this._config.fallback_title:room?.title;
        editor.hass=this._hass;editor.lovelace=this._lovelace || {views:[]};
        editor.setConfig({type:'vertical-stack',cards:cards || [],...(title?{title}:{})});
        editor.addEventListener('config-changed',event=>{event.stopPropagation();this._roomCardsChanged(target,event.detail.config);});
        this._editors.push(editor);host.replaceChildren(editor);
      } catch(error) {host.replaceChildren(el('p','The Home Assistant card editor could not load. Close and reopen this editor to retry.'));}
    }
    _roomReadingsSettings(panel, roomId) {
      panel.append(el('h3','Room readings'));
      const form = document.createElement('ha-form');
      this._readingsForm = form;
      form.hass = this._hass;
      panel.append(el('p','Temperature and humidity appear beside the room name, with CO₂ below on the right. CO₂ warnings change the icon and colour; phone notifications are managed separately.'));
      form.schema = [...ROOM_READING_SLOTS.map(slot => ({
        name:slot.name,
        selector:{entity:{domain:slot.domain,device_class:slot.deviceClass,multiple:slot.name === 'window'}}
      })),...['carbon_dioxide_warning','carbon_dioxide_high'].map(name => ({
        name,selector:{number:{min:400,max:10000,step:50,mode:'box',unit_of_measurement:'ppm'}}
      }))];
      const labels = {carbon_dioxide_warning:'CO₂ amber warning at (ppm)',carbon_dioxide_high:'CO₂ red warning at (ppm)'};
      form.computeLabel = field => labels[field.name] || ROOM_READING_SLOTS.find(slot => slot.name === field.name)?.label || field.name;
      const readings = this._config.rooms[roomId]?.readings || {};
      form.data = {carbon_dioxide_warning:1000,carbon_dioxide_high:2000,...readings,window:readingEntities(readings.window)};
      form.addEventListener('value-changed', event => {
        if (!event.detail.value || typeof event.detail.value !== 'object') return;
        event.stopPropagation();
        const rooms = this._config.rooms;
        this._change('rooms',{...rooms,[roomId]:{...rooms[roomId],readings:event.detail.value}});
        this._key = this._editorKey();
        this._updateRoomPreview();
      });
      panel.append(form);
    }
    _roomSettings(panel,areas) {
      panel.append(el('h3','Cards for each room'));
      panel.append(el('p','Select a room, then use the numbered tabs and + to add cards. Stacks and Conditional cards work here too. Changes are saved with the main Save button.'));
      const configured=Object.keys(this._config.rooms || {});
      if(!this._selectedRoom || (this._selectedRoom!=='__fallback__' && !configured.includes(this._selectedRoom)))this._selectedRoom=configured[0] || '__fallback__';
      const select=el('select');select.setAttribute('aria-label','Edit cards for room');
      for(const id of configured) {const option=el('option',areas.find(a=>a.area_id===id)?.name || id);option.value=id;select.append(option);}
      const fallback=el('option','Default / away cards');fallback.value='__fallback__';select.append(fallback);select.value=this._selectedRoom;
      select.addEventListener('change',()=>{this._selectedRoom=select.value;this._key=null;this._render();});panel.append(select);
      const add=el('select');add.setAttribute('aria-label','Add a room');const placeholder=el('option','Add a room…');placeholder.value='';add.append(placeholder);
      for(const area of areas.filter(a=>!configured.includes(a.area_id))) {const option=el('option',area.name);option.value=area.area_id;add.append(option);}
      add.addEventListener('change',()=>{if(!add.value)return;this._selectedRoom=add.value;this._change('rooms',{...this._config.rooms,[add.value]:{cards:[]}});this._key=null;this._render();});panel.append(add);
      if(this._selectedRoom!=='__fallback__') {
        const remove=el('button','Remove this room');remove.type='button';remove.addEventListener('click',()=>{if(!window.confirm('Remove this room configuration and its cards?'))return;const rooms={...this._config.rooms};delete rooms[this._selectedRoom];this._selectedRoom=null;this._change('rooms',rooms);this._key=null;this._render();});panel.append(remove);
      }
      panel.append(el('p',this._selectedRoom==='__fallback__'?'Used when away or no stable location is available. Choose the default room below.':'These cards appear when this room is detected. User and time conditions can be added using a Conditional card.'));
      this._readingsForm = null;
      if (this._selectedRoom !== '__fallback__') this._roomReadingsSettings(panel, this._selectedRoom);
      const previewLabel=this._selectedRoom==='__fallback__'?'Default / away cards':areas.find(a=>a.area_id===this._selectedRoom)?.name || this._selectedRoom;
      panel.append(el('h3','Preview · '+previewLabel));
      this._previewHost=el('div');this._previewHost.setAttribute('aria-label','Room cards preview');panel.append(this._previewHost);this._updateRoomPreview();
      const host=el('div');host.append(el('p','Loading Home Assistant card editor…'));panel.append(host);this._mountCards(host,this._selectedRoom);
    }
    _temperatureSettings(panel,areas) {
      panel.append(el('h3','Temperature-aware suggestions'));
      panel.append(el('p','Offer heating or fan controls when the selected room needs them. Nothing runs automatically. Away/unknown people, unavailable sensors and an open/unknown window suppress heating suggestions. A half-degree hysteresis prevents flickering.'));
      const configured=this._config.temperature_suggestions || {};
      if(!areas.some(a=>a.area_id===this._temperatureRoom))this._temperatureRoom=Object.keys(configured)[0] || areas[0]?.area_id;
      const select=el('select');select.setAttribute('aria-label','Room for temperature suggestions');
      for(const area of areas){const option=el('option',area.name);option.value=area.area_id;select.append(option);}select.value=this._temperatureRoom || '';
      select.addEventListener('change',()=>{this._temperatureRoom=select.value;this._key=null;this._render();});panel.append(select);
      if(!this._temperatureRoom)return;
      const cfg=configured[this._temperatureRoom] || {};
      const form=document.createElement('ha-form');this._temperatureForm=form;form.hass=this._hass;
      const labels={enabled:'Enable temperature suggestions for this room',allow_home_fallback:'Also suggest for the default room while I am home',temperature_entity:'Room temperature sensor',heater_entity:'Heater to suggest',fan_entity:'Fan controls to suggest (optional)',window_entity:'Window sensor (optional)',cold_below:'Suggest heating below (°C)',warm_above:'Suggest cooling above (°C)',target_temperature:'Suggested heating target (°C)'};
      form.schema=[{name:'enabled',selector:{boolean:{}}},{name:'allow_home_fallback',selector:{boolean:{}}},{name:'temperature_entity',selector:{entity:{domain:'sensor',device_class:'temperature'}}},{name:'heater_entity',selector:{entity:{domain:'climate'}}},{name:'fan_entity',selector:{entity:{domain:'fan'}}},{name:'window_entity',selector:{entity:{domain:'binary_sensor'}}},...['cold_below','warm_above','target_temperature'].map(name=>({name,selector:{number:{min:5,max:35,step:0.5,mode:'box'}}}))];
      form.computeLabel=s=>labels[s.name] || s.name;
      form.data={enabled:false,allow_home_fallback:false,cold_below:19,warm_above:25,target_temperature:20,...cfg};
      form.addEventListener('value-changed',event=>{if(!event.detail.value || typeof event.detail.value!=='object')return;event.stopPropagation();const map=this._config.temperature_suggestions || {};const next={...map,[this._temperatureRoom]:{...map[this._temperatureRoom],...event.detail.value}};form.data=next[this._temperatureRoom];this._config={...this._config,temperature_suggestions:next};this._key=this._editorKey();this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this._config},bubbles:true,composed:true}));});
      panel.append(form);
    }
    _render() {
      if(!this._config)return;
      const areas=Object.values(this._hass?.areas || {}).sort((a,b)=>a.name.localeCompare(b.name));
      const key=this._editorKey();if(key===this._key)return;this._key=key;this._editors=[];this._previewVersion=(this._previewVersion || 0)+1;this._previewHost=null;this._roomPreview=null;
      this.shadowRoot.innerHTML='<style>:host{display:block;color:var(--primary-text-color)}.settings{display:grid;gap:12px;padding:8px}label{display:flex;align-items:center;gap:12px;min-height:36px;font-size:14px}input{width:18px;height:18px;accent-color:var(--primary-color)}select{padding:10px;font:inherit;color:var(--primary-text-color);background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:8px;width:100%}p{font-size:13px;color:var(--secondary-text-color);line-height:1.5}h3{margin:12px 0 0;font-size:15px}</style>';
      const panel=el('div',undefined,'settings');
      if(this._config.type!=='custom:personal-shortcuts-card')this._roomSettings(panel,areas);
      this._temperatureSettings(panel,areas);
      panel.append(el('h3','Automatic room controls'));
      const followsTiming=this._config.type==='custom:personal-shortcuts-card' && this._config.follow_room_timing!==false;
      const linkedTiming=ROOM_TIMINGS.get(`personal-room:v1:${location.origin}:${this._hass?.user?.id || 'anonymous'}:${this._config.storage_id || 'wip'}`);
      const options=[
        ['stabilize_room','Wait for a steady room signal',true],
        ['hold_last_room','Keep the last room through brief signal loss',true],
        ['pause_on_interaction','Pause switching while controls are being used',true],
        ['require_home','Only follow the person’s room while they are home',false],
        ['auto_area_controls','Use area controls when no room cards are configured',true],
        ['hide_unavailable','Hide unavailable controls (may move other controls)',false],
        ['show_suggestions','Show useful shortcuts',true],
        ['learn_shortcuts','Learn from shortcut taps on this device',true],
        ['show_tracking_details','Show tracking details below the room name',false],
        ['show_room_navigation','Show a Browse rooms button',false],
        ['show_room_picker','Show room selection, Auto and Pin (shared displays)',false],
        ['show_household','Show who else is home',true],
        ['show_still_on','When away: show what is still on at home',true],
        ['show_all_off','When away and nobody else is home: offer All off',true]
      ];
      if(this._config.type==='custom:personal-shortcuts-card')options.unshift(['follow_room_timing','Follow the room card’s switching timings',true]);
      for(const [name,label,fallback] of options) {const row=el('label');const check=el('input');check.type='checkbox';check.disabled=followsTiming && ['stabilize_room','hold_last_room','pause_on_interaction'].includes(name);check.checked=followsTiming && linkedTiming && ['stabilize_room','hold_last_room','pause_on_interaction'].includes(name)?linkedTiming[['stabilize_room','hold_last_room','pause_on_interaction'].indexOf(name)]>0:this._config[name]===undefined?fallback:!!this._config[name];check.addEventListener('change',()=>this._change(name,check.checked));row.append(check,el('span',label));panel.append(row);}
      panel.append(el('h3','Room switching timings'));
      panel.append(el('p','The separate suggestions card follows the room card’s timings by default. Each viewer still has their own room state. Presets on a suggestions card switch it to independent timing.'));
      const presets=el('div');presets.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
      for(const [label,delay,grace,hold] of [['Responsive',10,45,10],['Balanced',30,90,20],['Extra steady',60,180,30]]) {
        const button=el('button',label);button.type='button';button.addEventListener('click',()=>{
          this._config={...this._config,stabilize_room:true,hold_last_room:true,pause_on_interaction:true,room_switch_delay:delay,room_loss_grace:grace,interaction_hold:hold,follow_room_timing:false};
          this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this._config},bubbles:true,composed:true}));this._key=null;this._render();
        });presets.append(button);
      }panel.append(presets);
      for(const [key,label,fallback,max,enabled] of [['room_switch_delay','New room must stay detected (seconds)',30,300,'stabilize_room'],['room_loss_grace','Keep last room after signal loss (seconds)',90,600,'hold_last_room'],['interaction_hold','Wait after using a control (seconds)',20,120,'pause_on_interaction']]) {
        const row=el('label');row.className='timing';const input=el('input');input.type='number';input.min='0';input.max=String(max);input.step='1';input.value=String(followsTiming && linkedTiming?linkedTiming[['room_switch_delay','room_loss_grace','interaction_hold'].indexOf(key)]/1000:timingSeconds(this._config[key],fallback,max));input.disabled=followsTiming || this._config[enabled]===false;input.setAttribute('aria-label',label);input.style.cssText='width:100px;height:auto;min-height:36px;margin-left:auto;padding:6px;border-radius:6px;border:1px solid var(--divider-color);color:var(--primary-text-color);background:var(--card-background-color)';
        input.addEventListener('change',()=>{if(!Number.isFinite(input.valueAsNumber))return;const value=timingSeconds(input.valueAsNumber,fallback,max);input.value=String(value);this._change(key,value);});row.append(el('span',label),input);panel.append(row);
      }
      panel.append(el('h3','Fixed room for a smart display'));
      const select=el('select');select.setAttribute('aria-label','Fixed room for a smart display');const auto=el('option','Follow the signed-in person');auto.value='';select.append(auto);
      for(const area of areas) {const o=el('option',area.name);o.value=area.area_id;select.append(o);}select.value=this._config.fixed_area || '';select.addEventListener('change',()=>this._change('fixed_area',select.value || null));panel.append(select);
      panel.append(el('h3','Default room when away or location is unknown'));
      const fallbackSelect=el('select');fallbackSelect.setAttribute('aria-label','Default room');const noFallback=el('option','No default room');noFallback.value='';fallbackSelect.append(noFallback);
      for(const area of areas) {const o=el('option',area.name);o.value=area.area_id;fallbackSelect.append(o);}fallbackSelect.value=this._config.fallback_area || '';fallbackSelect.addEventListener('change',()=>this._change('fallback_area',fallbackSelect.value || null));panel.append(fallbackSelect);
      this._householdSettings(panel);
      panel.append(el('p','Advanced YAML: card_rules can match people and rooms. Add a native Conditional card inside either for time, state and other conditions. These display rules do not change Home Assistant permissions.'));
      this.shadowRoot.append(panel);this._key=this._editorKey();
    }
    _householdSettings(panel) {
      panel.append(el('h3','Household & away'));
      panel.append(el('p','Who counts as living here, and what the card shows while you are away. Everyone with a login and a tracker counts unless you leave them out here.'));
      const form=document.createElement('ha-form');this._householdForm=form;form.hass=this._hass;
      form.schema=[
        {name:'household_exclude',selector:{entity:{domain:'person',multiple:true}}},
        {name:'away_title',selector:{text:{}}},
        {name:'away_rooms',selector:{boolean:{}}},
        {name:'still_on_limit',selector:{number:{min:1,max:30,step:1,mode:'box'}}},
        {name:'still_on_exclude',selector:{entity:{domain:['light','fan','media_player','climate'],multiple:true}}}
      ];
      const labels={household_exclude:'Not part of the household (kiosk or tablet logins)',away_title:'Title while away (default: your home name)',away_rooms:'While away, list every room with controls',still_on_limit:'"Still on at home": tiles before "…and N more"',still_on_exclude:'Never list these as still on'};
      form.computeLabel=field=>labels[field.name] || field.name;
      const c=this._config;
      form.data={household_exclude:c.household_exclude || [],away_title:c.away_title || '',away_rooms:c.away_rooms!==false,still_on_limit:c.still_on_limit || 8,still_on_exclude:c.still_on_exclude || []};
      form.addEventListener('value-changed',event=>{
        const v=event.detail.value;if(!v || typeof v!=='object')return;event.stopPropagation();
        const next={...this._config};
        for(const key of ['household_exclude','still_on_exclude']) {if(v[key]?.length)next[key]=v[key];else delete next[key];}
        if(v.away_title)next.away_title=v.away_title;else delete next.away_title;
        if(v.away_rooms===false)next.away_rooms=false;else delete next.away_rooms;
        if(v.still_on_limit && v.still_on_limit!==8)next.still_on_limit=v.still_on_limit;else delete next.still_on_limit;
        this._config=next;form.data=v;this._key=this._editorKey();
        this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this._config},bubbles:true,composed:true}));
      });
      panel.append(form);
    }
  }
  if (!customElements.get('personal-room-card-editor')) customElements.define('personal-room-card-editor',PersonalRoomEditor);
  class PersonalStatusPills extends HTMLElement {
    constructor() {super();this.attachShadow({mode:'open'});}
    setConfig(config) {this._config=config;this._key='';this._render();}
    set hass(hass) {this._hass=hass;this._render();}
    getCardSize() {return 1;}
    getGridOptions() {return {columns:12,rows:'auto'};}
    connectedCallback() {clearInterval(this._timer);this._timer=setInterval(()=>this._render(),60000);this._render();}
    disconnectedCallback() {clearInterval(this._timer);}
    _render() {
      if(!this._config || !this._hass || !this.isConnected) return;
      const h=this._hass;
      const person=h.user?.id?Object.values(h.states).find(s=>s.entity_id.startsWith('person.') && s.attributes.user_id===h.user.id):undefined;
      const profile=this._config.profiles?.[person?.entity_id] || {};
      const devices=new Set((person?.attributes.device_trackers || []).map(id=>h.entities?.[id]?.device_id).filter(Boolean));
      const own=Object.values(h.states).filter(s=>devices.has(h.entities?.[s.entity_id]?.device_id));
      const specs=profile.devices || own.filter(s=>s.entity_id.startsWith('sensor.') && s.attributes.device_class==='battery').map(s=>{
        const deviceId=h.entities[s.entity_id].device_id;
        const charging=own.find(x=>h.entities?.[x.entity_id]?.device_id===deviceId && (h.entities?.[x.entity_id]?.translation_key==='battery_state' || /battery_state(?:_\d+)?$/.test(x.entity_id)));
        return {entity:s.entity_id,state_entity:charging?.entity_id,label:h.devices?.[deviceId]?.name_by_user || h.devices?.[deviceId]?.name || 'Battery',icon:'mdi:battery'};
      });
      const items=specs.map(spec=>{
        const s=h.states[spec.entity], charge=h.states[spec.state_entity]?.state?.toLowerCase().replaceAll(' ','_');
        const full=charge==='full' || charge==='charged', charging=charge==='charging';
        const text=stateOK(s) ? `${spec.label} ${s.state}%${full?' · charged':charging?' · charging':''}` : `${spec.label} unavailable`;
        return {entity:spec.entity,text,icon:charging?'mdi:battery-charging':spec.icon || 'mdi:battery',highlight:full || charging,title:stateOK(s) ? `${spec.label}: ${s.state}%. ${full?'Fully charged':charging?'Charging':charge==='not_charging'?'Not charging':charge==='discharging'?'On battery':'Charging status unavailable'}. Tap for details.` : 'This device is not reporting its battery.'};
      });
      const alarmId=profile.alarm_entity || own.find(s=>h.entities?.[s.entity_id]?.translation_key==='next_alarm' || /_next_alarm$/.test(s.entity_id))?.entity_id;
      if(alarmId) {
        const alarm=h.states[alarmId], timestamp=Date.parse(alarm?.state), future=Number.isFinite(timestamp) && timestamp>Date.now();
        let text='Alarm not reporting',title='The phone has not supplied its next alarm. This does not mean no alarm is set.';
        // The Android app reports next_alarm as unavailable when no alarm is set. If the same
        // phone reported anything else in the last 2 hours, it is online: read that as "no alarm".
        const alarmDevice=h.entities?.[alarmId]?.device_id;
        const phoneOnline=!!alarmDevice && own.some(x=>x.entity_id!==alarmId && h.entities?.[x.entity_id]?.device_id===alarmDevice && stateOK(x) && Date.now()-Date.parse(x.last_updated)<2*3600000);
        if(alarm?.state==='unavailable' && phoneOnline) {text='No alarm set';title='Your phone is online and has no upcoming alarm.';}
        if(future) {
          const locale=h.locale?.language || h.language || 'en-GB', zone=h.config?.time_zone;
          const fmt=new Intl.DateTimeFormat(locale,{timeZone:zone,weekday:'short',hour:'2-digit',minute:'2-digit'});
          text=`Alarm ${fmt.format(new Date(timestamp))}`;title=`Next alarm: ${fmt.format(new Date(timestamp))}`;
        } else if(Number.isFinite(timestamp)) {text='Alarm needs refresh';title='The reported alarm time is in the past. Open the phone app to update it.';}
        items.push({entity:alarmId,text,icon:future?'mdi:alarm-check':'mdi:alarm',highlight:future,title});
      }
      const key=JSON.stringify([h.user?.id,items]);if(key===this._key)return;this._key=key;
      this.shadowRoot.innerHTML=`<style>:host{display:block}.pills{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;padding:2px 0 8px}button{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:7px 11px;min-height:36px;border:1px solid var(--divider-color);background:var(--ha-card-background,var(--card-background-color));color:var(--primary-text-color);font:inherit;font-size:12px;cursor:pointer;backdrop-filter:blur(12px)}button:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}ha-icon{--mdc-icon-size:18px}.ready ha-icon{color:var(--primary-color)}</style>`;
      const row=el('div',undefined,'pills');row.setAttribute('aria-label','Your devices and alarm');
      for(const item of items) {const b=el('button',undefined,item.highlight?'ready':'');b.title=item.title;const icon=el('ha-icon');icon.setAttribute('icon',item.icon);b.append(icon,el('span',item.text));b.addEventListener('click',()=>{if(h.states[item.entity]) this.dispatchEvent(new CustomEvent('hass-more-info',{detail:{entityId:item.entity},bubbles:true,composed:true}));});row.append(b);}
      this.shadowRoot.append(row);
    }
  }
  if (!customElements.get('personal-status-pills')) customElements.define('personal-status-pills',PersonalStatusPills);
  class PersonalShortcutsCard extends PersonalRoomCard {
    setConfig(config) {super.setConfig({...config,mode:'shortcuts'});}
    static getStubConfig() {return {...super.getStubConfig(),type:'custom:personal-shortcuts-card'};}
    getCardSize() {return 3;}
  }
  if (!customElements.get('personal-shortcuts-card')) customElements.define('personal-shortcuts-card',PersonalShortcutsCard);
  if (!customElements.get('personal-room-card')) customElements.define('personal-room-card',PersonalRoomCard);
  window.customCards=window.customCards || [];
  for (const card of [
    {type:'personal-shortcuts-card',name:'Personal Shortcuts',description:'Separate suggestions for the signed-in person and room; optional learning.'},
    {type:'personal-status-pills',name:'Personal Status Pills',description:'Device battery, charging and next alarm for the signed-in person.'},
    {type:'personal-room-card',name:'Personal Room',description:'Room controls for the signed-in person, with stable tracking and a local room pin.'}
  ]) if (!window.customCards.some(c => c.type === card.type)) window.customCards.push(card);
})();

/* Personal commute card: server-side NS entities; no API credentials in the browser. */
const pcEscape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pcNumber = (v, fallback) => v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : fallback;
function pcPerson(hass, preview) {
  if (preview) return preview;
  return Object.values(hass.states).find(s => s.entity_id.startsWith('person.') && s.attributes.user_id === hass.user?.id)?.entity_id;
}
function pcKey(user, storage) { return `personal-commute:${location.origin}:${storage || 'home'}:${user || 'anonymous'}`; }
function pcCandidates(hass, entity, nextEntity, now, travel, buffer) {
  const source = hass.states[entity], next = hass.states[nextEntity];
  const freshAt = Date.parse(source?.last_reported || source?.last_updated || '');
  const stale = !source || ['unknown','unavailable'].includes(source.state) || !Number.isFinite(freshAt) || now - freshAt > 15 * 60000;
  const attrs = source?.attributes || {};
  const rows = [{entity, value:source?.state, first:true, cancelled:attrs.going === false || attrs.status === 'cancelled'}, {entity:nextEntity, value:next?.state, first:false, cancelled:false}]
    .map(r => ({...r, timestamp: Date.parse(r.value || '')}))
    .filter(r => Number.isFinite(r.timestamp) && r.timestamp >= now)
    .sort((a,b) => a.timestamp-b.timestamp)
    .filter((r,i,a) => !i || r.timestamp !== a[i-1].timestamp)
    .map(r => ({...r, leaveAt:r.timestamp-(travel+buffer)*60000, reachable:r.timestamp-(travel+buffer)*60000 >= now}));
  return {stale, source, attrs, rows, chosen: stale ? null : rows.find(r => !r.cancelled && r.reachable)};
}
function pcAtWork(hass, personId, zoneId, now) {
  const person=hass.states[personId], zone=hass.states[zoneId];
  if (!person || !zone || person.state==='home') return false;
  if (person.attributes.in_zones?.includes(zoneId) || person.state === zone.attributes.friendly_name) return true;
  const gps=(person.attributes.device_trackers || []).map(id=>hass.states[id]).filter(s => s?.attributes.source_type==='gps' && now-Date.parse(s.last_updated)<30*60000 && pcNumber(s.attributes.gps_accuracy,999)<=150);
  return gps.some(s => {
    const a=s.attributes, b=zone.attributes;
    if (![a.latitude,a.longitude,b.latitude,b.longitude].every(Number.isFinite)) return false;
    const rad=x=>x*Math.PI/180, lat=rad(a.latitude-b.latitude), lon=rad(a.longitude-b.longitude);
    const q=Math.sin(lat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(lon/2)**2;
    return 6371000*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q)) <= Math.max(b.radius || 0,200);
  });
}
class PersonalCommuteCard extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});}
  static async getConfigElement(){return document.createElement('personal-commute-card-editor');}
  static getStubConfig(){return {profiles:{},storage_id:'home'};}
  setConfig(config){this._config=config;this._lastHTML=null;this.render();}
  set hass(hass){this._hass=hass;this.render();}
  connectedCallback(){this._tick=setInterval(()=>this.render(),15000);this.render();}
  disconnectedCallback(){clearInterval(this._tick);}
  getCardSize(){return 5;}
  getGridOptions(){return {columns:12,rows:'auto',min_columns:6};}
  time(ts){return new Intl.DateTimeFormat(this._hass.locale?.language || 'en-GB',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:this._hass.config.time_zone}).format(ts);}
  render(){
    const h=this._hass,c=this._config;if(!h||!c)return;
    const personId=pcPerson(h,c._preview_person),p=c.profiles?.[personId],now=Date.now();
    const e=pcEscape;
    let body='';
    if(!p?.home_entity || !p?.away_entity || !(pcNumber(p.home_minutes,0)>0) || !(pcNumber(p.away_minutes,0)>0)){
      body='<div class="empty">No commute set up for you yet.<small>In this card’s settings, choose your member profile, routes and station travel times.</small></div>';
    } else {
      let choice=null;
      const storageKey=pcKey(h.user?.id,c.storage_id);
      if(!c._preview_person){try{const v=JSON.parse(localStorage.getItem(storageKey));if(v?.until>now && ['home','away'].includes(v.direction))choice=v.direction;}catch{}}
      const atHome=h.states[personId]?.state==='home';
      const atWork=pcAtWork(h,personId,p.work_zone,now);
      const direction=choice || (atWork?'away':'home');
      const entity=p[`${direction}_entity`],next=p[`${direction}_next_entity`];
      const travel=pcNumber(p[`${direction}_minutes`],20),buffer=pcNumber(p.buffer_minutes,5);
      const m=pcCandidates(h,entity,next,now,travel,buffer);
      const route=m.attrs.route || [],label=route.length>1 ? `${route[0]} → ${route[route.length-1]}` : h.states[entity]?.attributes.friendly_name || 'Train journey';
      const context=choice?'Your selection · held for 2 hours':atWork?'Near work · homebound':atHome?'At home · outbound':'Location uncertain · choose your journey';
      const zone=h.config.time_zone;
      const first=m.chosen;
      const offline=h.connection?.connected===false;
      let summary;
      if(offline || m.stale)summary='<div class="empty">Live train data unavailable<small>Check the NS planner before leaving.</small></div>';
      else if(!first)summary='<div class="empty">No reachable train in these two departures<small>Allow more time and check the NS planner for later trains.</small></div>';
      else {
        const mins=Math.ceil((first.leaveAt-now)/60000);
        summary=`<div class="headline ${mins<=5?'soon':''}">${mins<=1?'Leave now':`Leave in ${mins} min`}</div><div class="detail">Leave by <b>${e(this.time(first.leaveAt))}</b> · train <b>${e(this.time(first.timestamp))}</b></div>`;
        if(!first.first)summary+='<small class="hint">Following departure · check its platform and disruption details in NS.</small>';
      }
      const rows=m.stale || offline ? '' : m.rows.map(r=>{
        const platform=r.first?(m.attrs.departure_platform_actual || m.attrs.departure_platform_planned):null;
        const planned=r.first?m.attrs.departure_time_planned:null;
        const actual=r.first?m.attrs.departure_time_actual:null;
        const detail=r.cancelled?'Cancelled':!r.reachable?'Too soon for your station trip':r===first?'Your reachable option':'Also reachable';
        return `<div class="departure ${r.cancelled || !r.reachable?'muted':''}"><b>${e(this.time(r.timestamp))}</b><span>${e(detail)}${platform?` · platform ${e(platform)}`:''}${planned&&actual&&planned!==actual?` · planned ${e(planned)}`:''}</span></div>`;
      }).join('');
      const catalog=c.routes || {},link=catalog[entity]?.planner_url || 'https://www.ns.nl/reisplanner/';
      body=`<div class="route">${e(label)}</div><small>${e(context)}</small><div class="modes"><button data-direction="home" class="${direction==='home'?'active':''}">Outbound</button><button data-direction="away" class="${direction==='away'?'active':''}">Homebound</button><button data-direction="auto" class="auto">${choice?'Use location':'Auto'}</button></div>${summary}<div class="departures">${rows}</div><div class="footer"><span>${travel} min to station + ${buffer} min margin</span><a href="${e(/^https:\/\/www\.ns\.nl\//.test(link)?link:'https://www.ns.nl/reisplanner/')}" target="_blank" rel="noopener noreferrer">NS planner ↗</a></div>`;
    }
    const html=`<style>:host{display:block}ha-card{padding:20px;box-sizing:border-box}header{display:flex;align-items:center;gap:10px;font-weight:600;font-size:17px;margin-bottom:16px}header ha-icon{color:var(--primary-color);--mdc-icon-size:23px}.route{font-size:16px;font-weight:600;margin-bottom:5px}small{display:block;color:var(--secondary-text-color);font-size:12px;line-height:1.5}.modes{display:flex;gap:6px;flex-wrap:wrap;margin:16px 0}button{font:inherit;font-size:12px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);border-radius:20px;padding:8px 13px;cursor:pointer}.active{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:transparent}.auto{margin-left:auto}.headline{font-size:30px;font-weight:650;line-height:1.2;letter-spacing:-.7px;margin-top:18px}.soon{color:var(--warning-color,#d58b20)}.detail{font-size:14px;margin-top:8px}.hint{margin-top:8px}.departures{margin-top:18px}.departure{display:flex;gap:13px;align-items:baseline;padding:9px 0;border-top:1px solid var(--divider-color);font-size:13px}.departure span{font-size:12px;color:var(--secondary-text-color)}.muted{opacity:.65}.footer{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--secondary-text-color);margin-top:15px}.footer a{color:var(--primary-color);text-decoration:none}.empty{font-size:16px;line-height:1.4;padding:12px 0}.empty small{margin-top:8px}button:focus-visible,a:focus-visible{outline:2px solid var(--primary-color);outline-offset:3px}</style><ha-card><header><ha-icon icon="mdi:train"></ha-icon>Your next train</header>${body}</ha-card>`;
    if(html===this._lastHTML)return;this._lastHTML=html;this.shadowRoot.innerHTML=html;
    this.shadowRoot.querySelectorAll('[data-direction]').forEach(b=>b.addEventListener('click',()=>{
      if(c._preview_person)return;
      try{const key=pcKey(h.user?.id,c.storage_id);if(b.dataset.direction==='auto')localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify({direction:b.dataset.direction,until:Date.now()+2*3600000}));}catch{}
      this._lastHTML=null;this.render();
    }));
  }
}
class PersonalCommuteEditor extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});}
  setConfig(c){this._config=structuredClone(c);this.render();}
  set hass(h){this._hass=h;if(!this._form)this.render();else{this._form.hass=h;if(this._preview)this._preview.hass=h;}}
  emit(){this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this._config},bubbles:true,composed:true}));}
  render(){
    const h=this._hass,c=this._config;if(!h||!c)return;
    const people=Object.values(h.states).filter(s=>s.entity_id.startsWith('person.')&&s.attributes.user_id);
    if(!people.some(s=>s.entity_id===this._person))this._person=pcPerson(h) || people[0]?.entity_id;
    const p=c.profiles?.[this._person] || {};
    const entities=Object.values(h.states).filter(s=>s.entity_id.startsWith('sensor.')&&s.attributes.route&&s.attributes.departure_time_planned).map(s=>({value:s.entity_id,label:s.attributes.route.join(' → ')}));
    const labels={home_entity:'Outbound train route',home_next_entity:'Following outbound departure sensor',home_minutes:'Home → station (minutes)',away_entity:'Homebound train route',away_next_entity:'Following homebound departure sensor',away_minutes:'Work → station (minutes)',buffer_minutes:'Extra platform margin (minutes)',work_zone:'Work zone (optional, for automatic direction)'};
    this.shadowRoot.innerHTML=`<style>:host{display:block}label{display:block;font-size:14px;margin-bottom:8px}select{width:100%;padding:12px;background:var(--card-background-color);color:var(--primary-text-color);border:1px solid var(--divider-color);border-radius:10px;font:inherit}p{font-size:12px;color:var(--secondary-text-color);line-height:1.5}.preview{margin-top:20px}h4{font-size:14px}</style><label>Member profile<select aria-label="Member profile">${people.map(s=>`<option value="${pcEscape(s.entity_id)}" ${s.entity_id===this._person?'selected':''}>${pcEscape(s.attributes.friendly_name)}</option>`).join('')}</select></label><p>Profiles follow HA users through their linked Person. Each member has their own station travel times. New members appear here automatically; their routes need selecting once.</p><div id="form"></div><div class="preview"><h4>Preview of the member you are editing</h4></div>`;
    this.shadowRoot.querySelector('select').addEventListener('change',e=>{this._person=e.target.value;this.render();});
    const number={number:{min:1,max:180,step:1,mode:'box'}};
    this._form=document.createElement('ha-form');this._form.hass=h;
    this._form.schema=[{name:'home_entity',selector:{select:{options:entities,custom_value:false}}},{name:'home_next_entity',selector:{entity:{domain:'sensor'}}},{name:'home_minutes',selector:number},{name:'away_entity',selector:{select:{options:entities,custom_value:false}}},{name:'away_next_entity',selector:{entity:{domain:'sensor'}}},{name:'away_minutes',selector:number},{name:'buffer_minutes',selector:{number:{min:0,max:30,step:1,mode:'box'}}},{name:'work_zone',selector:{entity:{domain:'zone'}}}];
    this._form.computeLabel=s=>labels[s.name] || s.name;
    this._form.data={...p,buffer_minutes:pcNumber(p.buffer_minutes,5)};
    this._form.addEventListener('value-changed',e=>{
      const value=e.detail.value;const previous=this._config.profiles?.[this._person] || {};const merged={...previous,...value};
      const routes=c.routes || {};
      for(const dir of ['home','away']){if(merged[`${dir}_entity`]!==previous[`${dir}_entity`]){const route=routes[merged[`${dir}_entity`]];const inferred=(merged[`${dir}_entity`] || '').replace(/_departure$/, '_next_departure');merged[`${dir}_next_entity`]=route?.next_entity || (h.states[inferred]?inferred:'');}}
      this._form.data=merged;
      c.profiles={...c.profiles,[this._person]:merged};this._config=c;this.emit();this.updatePreview();
    });
    this.shadowRoot.querySelector('#form').append(this._form);
    this._preview=document.createElement('personal-commute-card');this.shadowRoot.querySelector('.preview').append(this._preview);this.updatePreview();
  }
  updatePreview(){if(!this._preview)return;this._preview.setConfig({...this._config,_preview_person:this._person});this._preview.hass=this._hass;}
}
if(!customElements.get('personal-commute-card'))customElements.define('personal-commute-card',PersonalCommuteCard);
if(!customElements.get('personal-commute-card-editor'))customElements.define('personal-commute-card-editor',PersonalCommuteEditor);
window.customCards=window.customCards || [];if(!window.customCards.some(c=>c.type==='personal-commute-card'))window.customCards.push({type:'personal-commute-card',name:'Personal commute',description:'Your trains, leave-by time and personal station travel time',preview:true});

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
        const facts = [person.attributes.pronouns || [person.attributes.pronoun1, person.attributes.pronoun2].filter(Boolean).join('/'), person.attributes.birthday ? `birthday ${person.attributes.birthday}` : ''].filter(Boolean);
        if (facts.length) { const f = document.createElement('p'); f.textContent = facts.join(' · '); box.append(f); }
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

