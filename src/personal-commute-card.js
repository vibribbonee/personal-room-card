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
