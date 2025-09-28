/* WebGIS Sengketa/Potensi Masalah — Tarakan (v3.3 compact)
 * Fitur: impor GeoJSON/KML/KMZ/SHP(zip), gambar titik/garis/poligon,
 * edit geometri (dblclick), klik kiri=popup, klik kanan=context menu (props/edit/ekspor),
 * skema tipe data (string/number/boolean/date) + apply visible/all,
 * filter/status/severity/search, label NIB, rekap per kelurahan + chart + ekspor CSV,
 * pengaturan satuan panjang/luas, kontrol ukur sederhana (Polyline/Polygon).
 */
(function(){
  // ====== Helpers DOM ======
  const $ = (sel,root=document)=>root.querySelector(sel);
  const $$= (sel,root=document)=>Array.from(root.querySelectorAll(sel));
  const on = (el,ev,fn,opts)=>el&&el.addEventListener(ev,fn,opts);

  // ====== State ======
  const state = { q:"", status:"", sev:"", labels:false, unit:{len:"m", area:"m2"} };
  const schemaDefaults = { NIB:"string", Nomor_Hak:"string", Kecamatan:"string", Kelurahan:"string", Jenis:"string", Status:"string", Severity:"number", Tanggal:"date", Deskripsi:"string", Sumber:"string", LampiranURL:"string", Panjang_m_base:"number", Luas_m2_base:"number", Panjang_m:"number", Luas_m2:"number" };
  const schema = {...schemaDefaults};

  // ====== Map init ======
  const map = L.map('map').setView([3.304,117.58], 12);
  map.doubleClickZoom.disable();
  const base = {
    'OSM': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19, attribution:'&copy; OpenStreetMap'}).addTo(map),
    'Esri Imagery': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19}),
    'OpenTopo': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:17})
  };
  const drawnItems = new L.FeatureGroup().addTo(map);
  const palette = {'Tumpang tindih batas':'#ef4444','Sengketa waris':'#f97316','Ganda sertipikat':'#eab308','Penguasaan fisik/tanpa hak':'#22c55e','Tumpang tindih HGU/HGB':'#06b6d4','Batas tidak jelas/marker hilang':'#6366f1','Lainnya':'#a855f7'};
  const jenisKeys = Object.keys(palette); const jenisState = new Set(jenisKeys);
  const colorByJenis = p => palette[(p&&p.Jenis?String(p.Jenis):'').trim()] || '#0ea5e9';
  const styleByJenis = p => ({ color: colorByJenis(p), weight:1, fillOpacity:.25 });
  const dataLayer = L.geoJSON({type:'FeatureCollection',features:[]},{
    style:f=>styleByJenis(f.properties),
    pointToLayer:(f,latlng)=>L.circleMarker(latlng,{radius:6,color:colorByJenis(f.properties),weight:2,fillOpacity:.7}),
    onEachFeature:(f,layer)=>{attachLayerHandlers(layer); layer.bindPopup(popupHTML(f.properties||{}));}
  }).addTo(map);
  L.control.layers(base, {'Data Impor':dataLayer,'Hasil Gambar':drawnItems},{collapsed:true}).addTo(map);

  // ====== Measure buttons (tanpa plugin) ======
  const Measure = L.Control.extend({options:{position:'topleft'},onAdd:function(){
    const c=L.DomUtil.create('div','leaflet-bar');
    const b1=L.DomUtil.create('button','ctrl',c); b1.type='button'; b1.title='Ukur Panjang'; b1.textContent='📏';
    const b2=L.DomUtil.create('button','ctrl',c); b2.type='button'; b2.title='Ukur Luas'; b2.textContent='▢';
    L.DomEvent.disableClickPropagation(c);
    L.DomEvent.on(b1,'click',e=>{L.DomEvent.stop(e); new L.Draw.Polyline(map,{shapeOptions:{color:'#111'}}).enable();});
    L.DomEvent.on(b2,'click',e=>{L.DomEvent.stop(e); new L.Draw.Polygon(map,{shapeOptions:{color:'#111',fillOpacity:.15}}).enable();});
    return c;}});
  map.addControl(new Measure());

  // ====== Draw tools ======
  const drawCtl = new L.Control.Draw({ edit:{featureGroup:drawnItems}, draw:{circle:false} });
  map.addControl(drawCtl);
  map.on(L.Draw.Event.CREATED, e=>{ const layer=e.layer; layer.__isDrawn=true; layer.feature=layer.feature||{type:'Feature',properties:{}}; Object.assign(layer.feature.properties,{Jenis:'',Status:'Potensi',Severity:1}); recalcMetrics(layer); drawnItems.addLayer(layer); attachLayerHandlers(layer); layer.bindPopup(popupHTML(layer.feature.properties||{})); refresh(); });
  map.on(L.Draw.Event.EDITED, e=>{ try{ e.layers.eachLayer(l=>{ recalcMetrics(l); l.bindPopup(popupHTML(l.feature?.properties||{})); }); }catch{} refresh(); });
  map.on(L.Draw.Event.DELETED, ()=>refresh());

  // ====== Units ======
  const fmtLen = m=> m==null||isNaN(m)?'-': (state.unit.len==='km'? (m/1000).toFixed(3)+' km' : Math.round(m).toLocaleString('id-ID')+' m');
  const fmtArea = a=> a==null||isNaN(a)?'-': state.unit.area==='ha'? (a/10000).toFixed(4)+' ha' : state.unit.area==='km2'? (a/1e6).toFixed(4)+' km²' : Math.round(a).toLocaleString('id-ID')+' m²';

  // ====== Geometry utils ======
  function polyAreaMetersFromLatLngs(latlngs){ try{ const pts=(latlngs||[]).map(ll=>map.options.crs.project(ll)); if(pts.length<3) return 0; let a=0; for(let i=0;i<pts.length;i++){ const j=(i+1)%pts.length; a+=pts[i].x*pts[j].y-pts[j].x*pts[i].y; } return Math.abs(a/2);}catch{return 0;} }
  const lineLen = latlngs=>{ let l=0; for(let i=1;i<(latlngs||[]).length;i++) l+=map.distance(latlngs[i-1],latlngs[i]); return l; };
  function recalcMetrics(layer){ try{ const p=layer.feature.properties=layer.feature.properties||{}; p.Panjang_m=p.Panjang_m_base=p.Luas_m2=p.Luas_m2_base=p.Luas_ha=undefined; if(layer instanceof L.Polygon){ const rings=layer.getLatLngs(); const outer=Array.isArray(rings[0])?rings[0]:rings; const area=polyAreaMetersFromLatLngs(outer); p.Luas_m2_base=area; p.Luas_m2=Math.round(area); p.Luas_ha=(area/10000).toFixed(4);} else if(layer instanceof L.Polyline && !(layer instanceof L.Polygon)){ const len=lineLen(layer.getLatLngs()); p.Panjang_m_base=len; p.Panjang_m=Math.round(len);} }catch(e){console.warn('recalc',e);} }

  // ====== Popup ======
  function popupHTML(p){ const R=[['Jenis',p.Jenis],['Status',p.Status],['Severity',p.Severity],['NIB',p.NIB],['Nomor_Hak',p.Nomor_Hak],['Kecamatan',p.Kecamatan],['Kelurahan',p.Kelurahan],['Tanggal',p.Tanggal],['Sumber',p.Sumber],['Lampiran',p.LampiranURL],['Deskripsi',p.Deskripsi],['Panjang',fmtLen(p.Panjang_m_base??p.Panjang_m)],['Luas',fmtArea(p.Luas_m2_base??p.Luas_m2)]]; return R.filter(r=>r[1]!=null && r[1]!=='' && r[1]!=='-').map(r=>`<div><b>${r[0]}:</b> ${r[1]}</div>`).join(''); }

  // ====== Context menu ======
  let ctxDiv=null, ctxLayer=null; function ensureCtx(){ if(ctxDiv) return ctxDiv; ctxDiv=document.createElement('div'); ctxDiv.className='ctxmenu'; ctxDiv.innerHTML='<div class="item" data-act="props">ℹ️  Lihat properti</div><div class="item" data-act="edit">✏️  Edit geometri (toggle)</div><div class="item" data-act="expGeo">⬇️  Ekspor GeoJSON (fitur)</div><div class="item" data-act="expKml">⬇️  Ekspor KML (fitur)</div>'; document.body.appendChild(ctxDiv); ctxDiv.addEventListener('click',e=>{ const it=e.target.closest('.item'); if(!it) return; const act=it.getAttribute('data-act'); if(!ctxLayer) return hideCtx(); if(act==='props'){ selectFeature(ctxLayer); try{ctxLayer.openPopup();}catch{} } if(act==='edit'){ toggleEdit(ctxLayer); } if(act==='expGeo'){ exportOne('geojson',ctxLayer);} if(act==='expKml'){ exportOne('kml',ctxLayer);} hideCtx(); }); document.addEventListener('click',hideCtx); return ctxDiv; }
  function showCtx(latlng,layer){ const d=ensureCtx(); ctxLayer=layer; const p=map.latLngToContainerPoint(latlng); d.style.left=(p.x+5)+'px'; d.style.top=(p.y+5)+'px'; d.style.display='block'; }
  function hideCtx(){ if(ctxDiv) ctxDiv.style.display='none'; ctxLayer=null; }

  function exportOne(kind,layer){ const gj=layer.toGeoJSON?layer.toGeoJSON():(layer.feature||null); if(!gj) return; if(kind==='geojson'){ const blob=new Blob([JSON.stringify(gj,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(gj.properties?.NIB||'fitur')+'.geojson'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500);} else { const fc={type:'FeatureCollection',features:[gj]}; const kml=tokml(fc); const blob=new Blob([kml],{type:'application/vnd.google-earth.kml+xml'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(gj.properties?.NIB||'fitur')+'.kml'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500);} }
  function toggleEdit(layer){ try{ if(layer.editing && layer.editing.enabled()) layer.editing.disable(); else if(layer.editing) layer.editing.enable(); }catch(e){ console.warn('toggle edit',e); } }
  function attachLayerHandlers(layer){ layer.off('click').on('click',e=>{ selectFeature(layer); try{layer.openPopup(e.latlng);}catch{} }); layer.off('contextmenu').on('contextmenu',e=>{ L.DomEvent.stop(e); showCtx(e.latlng,layer); }); layer.off('dblclick').on('dblclick',e=>{ L.DomEvent.stop(e); toggleEdit(layer); }); if(!layer.__boundEdit){ layer.__boundEdit=true; layer.on('edit',()=>{ recalcMetrics(layer); layer.bindPopup(popupHTML(layer.feature?.properties||{})); refresh(); }); } }

  // ====== Importers ======
  on($('#impGeoJSON'),'change',ev=>handleFiles(ev,'geojson'));
  on($('#impKML'),'change',   ev=>handleFiles(ev,'kml'));
  on($('#impKMZ'),'change',   ev=>handleFiles(ev,'kmz'));
  on($('#impSHP'),'change',   ev=>handleFiles(ev,'shpzip'));
  async function handleFiles(ev,kind){ const f=ev.target.files&&ev.target.files[0]; ev.target.value=''; if(!f) return; try{ if(kind==='geojson'){ addGeoJSON(JSON.parse(await f.text())); } else if(kind==='kml'){ const dom=new DOMParser().parseFromString(await f.text(),'text/xml'); addGeoJSON(toGeoJSON.kml(dom)); } else if(kind==='kmz'){ const zip=await JSZip.loadAsync(await f.arrayBuffer()); const kmlName=Object.keys(zip.files).find(n=>n.toLowerCase().endsWith('.kml')); if(!kmlName) throw new Error('KML tidak ditemukan di KMZ'); const dom=new DOMParser().parseFromString(await zip.files[kmlName].async('text'),'text/xml'); addGeoJSON(toGeoJSON.kml(dom)); } else if(kind==='shpzip'){ addGeoJSON(await shp(await f.arrayBuffer())); } }catch(e){ alert('Gagal impor: '+e.message); } }
  function addGeoJSON(gj){ dataLayer.addData(gj); try{ map.fitBounds(dataLayer.getBounds(),{padding:[20,20]}); }catch{} dataLayer.eachLayer(l=>{ l.off('click').on('click',()=>selectFeature(l)); if(l.feature&&l.setStyle) l.setStyle(styleByJenis(l.feature.properties)); l.bindPopup(popupHTML(l.feature?.properties||{})); const p=l.feature?.properties||{}; Object.keys(p).forEach(k=>{ if(schema[k]) return; const v=p[k]; const t=(v==null)?'string': (typeof v==='number'?'number': typeof v==='boolean'?'boolean': (isDateStr(String(v))?'date':'string')); schema[k]=t; }); }); renderSchemaTable(); refresh(); }

  // ====== Export koleksi ======
  on($('#btnExport'),'click',()=>{ const fc=collectAll(); const blob=new Blob([JSON.stringify(fc,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='sengketa_tarakan.geojson'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500); });
  on($('#btnExportKML'),'click',()=>{ const fc=collectAll(); const kml=tokml(fc,{name:'Jenis',description:'Deskripsi'}); const blob=new Blob([kml],{type:'application/vnd.google-earth.kml+xml'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='sengketa_tarakan.kml'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500); });
  const collectAll=()=>{ const feats=[]; dataLayer.eachLayer(l=>{ if(l.toGeoJSON) feats.push(l.toGeoJSON()); }); drawnItems.eachLayer(l=>{ if(l.toGeoJSON) feats.push(l.toGeoJSON()); }); return {type:'FeatureCollection',features:feats}; };

  // ====== Filter UI ======
  on($('#q'),'input',()=>{ state.q=$('#q').value.trim().toLowerCase(); refresh(); });
  on($('#fStatus'),'change',()=>{ state.status=$('#fStatus').value; refresh(); });
  on($('#fSeverity'),'change',()=>{ state.sev=$('#fSeverity').value; refresh(); });
  on($('#toggleLabels'),'change',()=>{ state.labels=$('#toggleLabels').checked; refresh(); });
  on($('#btnReset'),'click',()=>{ $('#q').value=''; $('#fStatus').value=''; $('#fSeverity').value=''; $('#toggleLabels').checked=false; state.q=''; state.status=''; state.sev=''; state.labels=false; jenisState.clear(); jenisKeys.forEach(k=>jenisState.add(k)); $$('#legend .lg').forEach(cb=>cb.checked=true); refresh(); });
  on($('#lenUnit'),'change',()=>{ state.unit.len=$('#lenUnit').value; refresh(); });
  on($('#areaUnit'),'change',()=>{ state.unit.area=$('#areaUnit').value; refresh(); });

  // ====== Legend ======
  $('#legend').innerHTML = jenisKeys.map(k=>`<label class="legend-item"><input type="checkbox" class="lg" data-k="${k}" checked> <span class="sw" style="background:${palette[k]}"></span>${k}</label>`).join('');
  on($('#legend'),'change',e=>{ const el=e.target.closest('.lg'); if(!el) return; const key=el.getAttribute('data-k'); if(el.checked) jenisState.add(key); else jenisState.delete(key); refresh(); });

  // ====== Editor Atribut ======
  const isDateStr = s=> typeof s==='string' && s.length===10 && s[4]==='-' && s[7]==='-' && !isNaN(new Date(s).getTime());
  const setVal=(id,v)=>{ const el=$(id.startsWith('#')?id:'#'+id); if(el) el.value=(v==null?'':v); };
  const getVal=id=>$(id.startsWith('#')?id:'#'+id).value;
  function selectFeature(layer){ window.__selectedLayer=layer; const ft=layer.toGeoJSON?layer.toGeoJSON():layer.feature; const p=ft.properties||{}; Object.keys(p).forEach(k=>{ if(schema[k]) return; const v=p[k]; const t=(v==null)?'string': (typeof v==='number'?'number': typeof v==='boolean'?'boolean': (isDateStr(String(v))?'date':'string')); schema[k]=t; }); renderSchemaTable(); $('#selInfo').textContent=p.NIB||'(tanpa NIB)'; setVal('aNIB',p.NIB); setVal('aHak',p.Nomor_Hak); setVal('aKec',p.Kecamatan); setVal('aKel',p.Kelurahan); setVal('aJenis',p.Jenis); setVal('aStatus',p.Status||'Potensi'); setVal('aSev',p.Severity||1); setVal('aTgl',p.Tanggal); setVal('aDesc',p.Deskripsi); setVal('aSumber',p.Sumber); setVal('aURL',p.LampiranURL); }
  on($('#btnSaveAttr'),'click',()=>{ const Lyr=window.__selectedLayer; if(!Lyr) return alert('Pilih fitur di peta dulu.'); const draft={ NIB:getVal('#aNIB'), Nomor_Hak:getVal('#aHak'), Kecamatan:getVal('#aKec'), Kelurahan:getVal('#aKel'), Jenis:getVal('#aJenis'), Status:getVal('#aStatus'), Severity:getVal('#aSev'), Tanggal:getVal('#aTgl'), Deskripsi:getVal('#aDesc'), Sumber:getVal('#aSumber'), LampiranURL:getVal('#aURL') }; const casted={}; Object.keys(draft).forEach(k=>{ const t=schema[k]||'string'; casted[k]=castValue(t,draft[k]); }); if(Lyr.feature) Lyr.feature.properties={...(Lyr.feature.properties||{}),...casted}; if(Lyr.setStyle) Lyr.setStyle(styleByJenis(Lyr.feature.properties)); Lyr.bindPopup(popupHTML(Lyr.feature.properties)); refresh(); });
  on($('#btnAddField'),'click',()=>{ const Lyr=window.__selectedLayer; if(!Lyr) return alert('Pilih fitur di peta.'); const name=$('#newFieldName').value.trim(); if(!name) return alert('Nama field kosong'); const type=$('#newFieldType').value; let val=$('#newFieldValue').value; val=castValue(type,val); const ft=Lyr.toGeoJSON?Lyr.toGeoJSON():Lyr.feature; ft.properties=ft.properties||{}; ft.properties[name]=val; Lyr.feature=ft; schema[name]=type; renderSchemaTable(); alert('Field ditambahkan.'); refresh(); });
  function castValue(type,v){ if(type==='number'){ const n=Number(v); return isNaN(n)?null:n;} if(type==='boolean'){ if(typeof v==='boolean') return v; const s=String(v).toLowerCase().trim(); return (s==='true'||s==='1'||s==='ya'||s==='y'); } if(type==='date'){ const s=String(v).trim(); const d=isDateStr(s)?new Date(s):new Date(s); if(isNaN(d.getTime())) return null; return d.toISOString().split('T')[0]; } return (v==null?'':String(v)); }
  function renderSchemaTable(){ const body=$('#schemaTable tbody'); if(!body) return; const keys=Object.keys(schema).sort(); body.innerHTML=keys.map(k=>`<tr><td>${k}</td><td><select data-k="${k}" class="input"><option value="string" ${schema[k]==='string'?'selected':''}>string</option><option value="number" ${schema[k]==='number'?'selected':''}>number</option><option value="boolean" ${schema[k]==='boolean'?'selected':''}>boolean</option><option value="date" ${schema[k]==='date'?'selected':''}>date</option></select></td></tr>`).join(''); $$('#schemaTable select').forEach(sel=>on(sel,'change',e=>{ schema[e.target.getAttribute('data-k')]=e.target.value; })); }
  on($('#btnSaveSchema'),'click',()=>{ renderSchemaTable(); alert('Skema disimpan.'); });
  on($('#btnApplySchemaVisible'),'click',()=>{ featureArray().filter(o=>map.hasLayer(o.layer)).forEach(o=>{ applySchema(o.feature); o.layer.bindPopup(popupHTML(o.feature.properties||{})); }); alert('Skema diterapkan ke fitur terlihat.'); refresh(); });
  on($('#btnApplySchemaAll'),'click',()=>{ featureArray().forEach(o=>{ applySchema(o.feature); o.layer.bindPopup(popupHTML(o.feature.properties||{})); }); alert('Skema diterapkan ke semua fitur.'); refresh(); });
  const applySchema=ft=>{ const p=ft.properties||{}; Object.keys(p).forEach(k=>{ const t=schema[k]; if(!t) return; p[k]=castValue(t,p[k]); }); };

  // ====== Table & Recap ======
  function featureArray(){ const arr=[]; dataLayer.eachLayer(l=>{ if(l.feature) arr.push({layer:l,feature:l.feature}); }); drawnItems.eachLayer(l=>{ if(l.toGeoJSON) arr.push({layer:l,feature:l.toGeoJSON()}); }); return arr; }
  function centroidOf(geom){ try{ const t=geom.type; if(t==='Point') return geom.coordinates; function polyCentroid(coords){ const ring=coords[0]; let a=0,cx=0,cy=0; for(let i=0;i<ring.length-1;i++){ const [x1,y1]=ring[i], [x2,y2]=ring[i+1]; const s=x1*y2-x2*y1; a+=s; cx+=(x1+x2)*s; cy+=(y1+y2)*s; } a*=.5; if(!a) return ring[0]; return [cx/(6*a), cy/(6*a)]; } if(t==='Polygon') return polyCentroid(geom.coordinates); if(t==='MultiPolygon') return polyCentroid(geom.coordinates[0]); if(t==='LineString'){ return geom.coordinates[Math.floor(geom.coordinates.length/2)]; } }catch{} return null; }
  function boundsOf(geom){ let minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9; const add=(x,y)=>{if(x<minx)minx=x;if(y<miny)miny=y;if(x>maxx)maxx=x;if(y>maxy)maxy=y}; const proc=cs=>{ for(let i=0;i<cs.length;i++) add(cs[i][0],cs[i][1]); }; if(geom.type==='Point') add(geom.coordinates[0],geom.coordinates[1]); if(geom.type==='LineString') proc(geom.coordinates); if(geom.type==='Polygon') geom.coordinates.forEach(proc); if(geom.type==='MultiPolygon') geom.coordinates.forEach(p=>p.forEach(proc)); if(minx>maxx) return null; return [minx,miny,maxx,maxy]; }
  on($('#attrTable'), 'click', ev=>{ const tr=ev.target.closest('tr'); if(!tr) return; const i=Number(tr.getAttribute('data-idx')); const vis=featureArray().filter(o=>map.hasLayer(o.layer)); const it=vis[i]; if(!it) return; const gj=it.layer.toGeoJSON(); const b=boundsOf(gj.geometry); if(b) map.fitBounds([[b[1],b[0]],[b[3],b[2]]],{padding:[40,40]}); });

  function computeRecap(features){ const agg={}; for(let i=0;i<features.length;i++){ const ft=features[i]; const p=(ft&&ft.properties)?ft.properties:{}; const kel=String(p.Kelurahan||'—').trim()||'—'; const st=String(p.Status||'Potensi'); if(!agg[kel]) agg[kel]={Potensi:0,Terjadi:0,Selesai:0,Total:0}; if(st==='Terjadi') agg[kel].Terjadi++; else if(st==='Selesai') agg[kel].Selesai++; else agg[kel].Potensi++; agg[kel].Total++; } return agg; }
  let recapChart=null;
  function updateRecap(features){ const onlyPoly=$('#onlyPolygon')?.checked; const filtered = onlyPoly? features.filter(ft=>{const t=ft?.geometry?.type; return t==='Polygon'||t==='MultiPolygon';}) : features; const agg=computeRecap(filtered); $('#recapBody').innerHTML = Object.keys(agg).sort((a,b)=>agg[b].Total-agg[a].Total).map(k=>{const v=agg[k]; return `<tr><td>${k}</td><td>${v.Potensi}</td><td>${v.Terjadi}</td><td>${v.Selesai}</td><td><b>${v.Total}</b></td></tr>`}).join('') || '<tr><td colspan="5" class="muted">Belum ada data terlihat</td></tr>'; const labels=Object.keys(agg).sort((a,b)=>agg[b].Total-agg[a].Total).slice(0,15); const totals=labels.map(k=>agg[k].Total); const ctx=document.getElementById('recapChart').getContext('2d'); if(recapChart) recapChart.destroy(); recapChart=new Chart(ctx,{type:'bar',data:{labels,datasets:[{label:'Total per Kelurahan',data:totals}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true}}}}); on($('#btnExportRecap'),'click',()=>{ const header=['Kelurahan','Potensi','Terjadi','Selesai','Total']; const lines=[header.join(',')].concat(Object.keys(agg).map(k=>{const v=agg[k]; return [k,v.Potensi,v.Terjadi,v.Selesai,v.Total].join(',');})); const blob=new Blob([lines.join('\n')],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='rekap_kelurahan.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500); }); const onlyEl=$('#onlyPolygon'); if(onlyEl && !onlyEl.__bound){ onlyEl.__bound=true; on(onlyEl,'change',()=>updateRecap(features)); } }

  function refresh(){ // filter + labels + table + recap
    // filter
    const items=featureArray(); const qtxt=state.q;
    items.forEach(it=>{ const layer=it.layer, p=it.feature.properties||{}; const jenisOk = jenisState.size===0 || jenisState.has(String(p.Jenis||'')); const matchQ = !qtxt || Object.keys(p).some(k=>String(p[k]||'').toLowerCase().includes(qtxt)); const matchS = !state.status|| String(p.Status||'')===state.status; const matchV = !state.sev || String(p.Severity||'')===state.sev; const show = jenisOk && matchQ && matchS && matchV; if(show){ if(layer.__isDrawn) drawnItems.addLayer(layer); else dataLayer.addLayer(layer); if(layer.setStyle) layer.setStyle(styleByJenis(p)); } else { map.removeLayer(layer);} });
    // labels
    (window.__labels||[]).forEach(l=>map.removeLayer(l)); window.__labels=[]; if(state.labels){ items.forEach(it=>{ if(!map.hasLayer(it.layer)) return; const p=it.feature.properties||{}; const label=String(p.NIB||'').trim(); if(!label) return; const c=centroidOf((it.layer.toGeoJSON?it.layer.toGeoJSON():it.feature).geometry); if(c){ const t=L.tooltip({permanent:true,direction:'center',className:'lbl'}).setContent(label).setLatLng([c[1],c[0]]).addTo(map); (window.__labels).push(t);} }); }
    // table
    const vis=items.filter(o=>map.hasLayer(o.layer)); const rows=vis.slice(0,600).map((o,i)=>{ const p=o.feature.properties||{}; return `<tr data-idx="${i}"><td>${i+1}</td><td>${p.Jenis||''}</td><td>${p.Status||''}</td><td>${p.Severity||''}</td><td>${p.NIB||''}</td><td>${p.Nomor_Hak||''}</td><td>${p.Kecamatan||''}</td><td>${p.Kelurahan||''}</td></tr>`; }).join(''); $('#attrTable tbody').innerHTML=rows;
    // recap
    updateRecap(vis.map(v=>v.feature));
  }

  // ====== Legend bootstrap ======
  (function initLegend(){ const legendDiv=$('#legend'); legendDiv.innerHTML= jenisKeys.map(k=>`<label class="legend-item"><input type="checkbox" class="lg" data-k="${k}" checked> <span class="sw" style="background:${palette[k]}"></span>${k}</label>`).join(''); })();

  // ====== Locate ======
  on($('#btnLocate'),'click',()=>map.locate({setView:true,maxZoom:16}));

  // ====== Add by draw buttons ======
  on($('#btnAddPoint'),'click',()=> new L.Draw.Marker(map).enable());
  on($('#btnAddLine'),'click', ()=> new L.Draw.Polyline(map).enable());
  on($('#btnAddPoly'),'click', ()=> new L.Draw.Polygon(map).enable());

  // ====== Add by typed coordinates ======
  on($('#btnAddPointCoord'),'click',()=>{ const txt=$('#ptLonLat').value.trim(); if(!txt) return; const a=txt.split(',').map(s=>Number(s.trim())); if(a.length<2||a.some(isNaN)) return alert('Format salah. Gunakan "lon,lat"'); const m=L.marker([a[1],a[0]]); m.feature={type:'Feature',properties:{Status:'Potensi',Severity:1}}; drawnItems.addLayer(m); attachLayerHandlers(m); refresh(); });
  function parsePts(){ const s=$('#wktSimple').value.trim(); return s.split(';').map(p=>p.trim()).filter(Boolean).map(p=>{ const a=p.split(','); return [Number(a[0]),Number(a[1])]; }); }
  on($('#btnAddLineCoord'),'click',()=>{ const pts=parsePts(); if(pts.length<2||pts.some(p=>p.some(isNaN))) return alert('Format salah. Gunakan "lon,lat; lon,lat; ..."'); const ll=pts.map(c=>[c[1],c[0]]); const l=L.polyline(ll); l.feature={type:'Feature',properties:{Status:'Potensi',Severity:1}}; recalcMetrics(l); drawnItems.addLayer(l); attachLayerHandlers(l); refresh(); });
  on($('#btnAddPolyCoord'),'click',()=>{ const pts=parsePts(); if(pts.length<3||pts.some(p=>p.some(isNaN))) return alert('Format salah. Gunakan "lon,lat; lon,lat; ..."'); const ll=pts.map(c=>[c[1],c[0]]); const g=L.polygon(ll); g.feature={type:'Feature',properties:{Status:'Potensi',Severity:1}}; recalcMetrics(g); drawnItems.addLayer(g); attachLayerHandlers(g); refresh(); });

  // ====== Unit tests (ringkas; tidak mengubah yang sudah ada) ======
  ;(function tests(){ const deepEq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const fts1=[{properties:{Kelurahan:'A',Status:'Potensi'},geometry:{type:'Polygon'}},{properties:{Kelurahan:'A',Status:'Terjadi'},geometry:{type:'Polygon'}},{properties:{Kelurahan:'B',Status:'Selesai'},geometry:{type:'Point'}},{properties:{Kelurahan:'A',Status:'Potensi'},geometry:{type:'Polygon'}}];
    const exp1={A:{Potensi:2,Terjadi:1,Selesai:0,Total:3},B:{Potensi:0,Terjadi:0,Selesai:1,Total:1}}; console.assert(deepEq(computeRecap(fts1),exp1),'UT1 gagal');
    const fts2=[{properties:{Status:'Unknown'},geometry:{type:'Polygon'}},{properties:{Kelurahan:'—',Status:'Selesai'},geometry:{type:'Polygon'}}]; const exp2={'—':{Potensi:1,Terjadi:0,Selesai:1,Total:2}}; console.assert(deepEq(computeRecap(fts2),exp2),'UT2 gagal');
    const onlyPoly=fts1.filter(ft=>ft.geometry.type==='Polygon'); const exp3={A:{Potensi:2,Terjadi:1,Selesai:0,Total:3}}; console.assert(deepEq(computeRecap(onlyPoly),exp3),'UT3 gagal');
    console.assert(castValue('number','12.5')===12.5,'cast num'); console.assert(castValue('boolean','0')===false && castValue('boolean','true')===true,'cast bool'); const d=castValue('date','2025-01-02'); console.assert(/^2025-01-02$/.test(d||''),'cast date');
    console.log('%cUnit tests selesai.','color:green'); })();

  // ====== First render ======
  refresh();
})();