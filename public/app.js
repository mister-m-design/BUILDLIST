const KEY='buildlist.v1';
const CFG=window.BUILDLIST_CONFIG||{};
const configured=CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes('YOUR-PROJECT') && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes('YOUR-PUBLIC');
const sb = configured ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: 'buildlist-auth'
  }
}) : null;
let session=null;
let state={applications:[],projects:[],features:[],agentNotes:[]};
let activeView='all', activeProject=null, activeApp=null, editingId=null, editingProjectId=null;

const $=id=>document.getElementById(id);
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),2200)}
function appName(id){return state.applications.find(a=>a.id===id)?.name||'Other'}
function projectName(id){return state.projects.find(p=>p.id===id)?.name||'No Project'}
function projectById(id){return state.projects.find(p=>p.id===id)}
function projectAppName(projectId){const p=projectById(projectId);return p?appName(p.application_id):'Other'}
function projectOwnReady(projectId){return !!projectById(projectId)?.ready_for_agent}
function projectReady(projectId){
  let p=projectById(projectId), seen=new Set();
  while(p&&!seen.has(p.id)){
    if(p.ready_for_agent)return true;
    seen.add(p.id);
    p=p.parent_project_id?projectById(p.parent_project_id):null;
  }
  return false;
}
function descendantProjectIds(projectId){
  const out=new Set([projectId]), queue=[projectId];
  while(queue.length){
    const id=queue.shift();
    state.projects.filter(p=>p.parent_project_id===id).forEach(p=>{
      if(!out.has(p.id)){out.add(p.id);queue.push(p.id)}
    });
  }
  return out;
}
function projectTrail(projectId){
  const parts=[], seen=new Set(); let p=projectById(projectId);
  while(p&&!seen.has(p.id)){parts.unshift(p);seen.add(p.id);p=p.parent_project_id?projectById(p.parent_project_id):null}
  return parts;
}
function currentUser(){return session?.user?.id}

async function init(){
  if(!configured){$('authMessage').textContent='Add your Supabase URL and anon key to config.js first.';return}
  const {data}=await sb.auth.getSession(); session=data.session;
  sb.auth.onAuthStateChange(async (_event,s)=>{session=s; await routeAuth();});
  await routeAuth();
}
async function routeAuth(){
  const logged=!!session;
  $('authGate').style.display=logged?'none':'grid';
  $('appShell').hidden=!logged;
  if(logged) await loadCloud();
}
async function login(){
  const email=$('authEmail').value.trim();
  const password=$('authPassword').value;
  if(!email||!password){$('authMessage').textContent='Enter your email and password.';return}
  $('authMessage').textContent='Signing in…';
  const {error}=await sb.auth.signInWithPassword({email,password});
  $('authMessage').textContent=error?error.message:'';
}
function togglePasswordSetup(){
  const panel=$('passwordSetupPanel');
  const show=panel.style.display==='none'||!panel.style.display;
  panel.style.display=show?'grid':'none';
  $('authMessage').textContent=show?'Enter the same Agent Feed Token you saved for Claude, then choose a new password.':'';
}
async function setupPassword(){
  const token=$('setupToken').value.trim();
  const password=$('setupPassword').value;
  const confirmPassword=$('setupPasswordConfirm').value;
  if(!token){$('authMessage').textContent='Enter your Agent Feed Token.';return}
  if(password.length<8){$('authMessage').textContent='Password must be at least 8 characters.';return}
  if(password!==confirmPassword){$('authMessage').textContent='Passwords do not match.';return}
  $('authMessage').textContent='Setting password…';
  try{
    const response=await fetch('/api/auth/set-password',{
      method:'POST',
      headers:{
        'Authorization':'Bearer '+token,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({password})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){$('authMessage').textContent=data.error||'Could not set password.';return}
    $('authPassword').value=password;
    $('passwordSetupPanel').style.display='none';
    $('setupToken').value='';
    $('setupPassword').value='';
    $('setupPasswordConfirm').value='';
    $('authMessage').textContent='Password set. Click Sign In.';
  }catch(e){
    $('authMessage').textContent='Could not reach password setup endpoint.';
  }
}
async function setPassword(){
  const token=prompt('Enter your Agent Feed Token:');
  if(token===null)return;
  const password=prompt('Choose a new Buildlist password (at least 8 characters):');
  if(password===null)return;
  if(password.length<8){toast('Password must be at least 8 characters');return}
  const confirmPassword=prompt('Enter the new password again:');
  if(confirmPassword!==password){toast('Passwords do not match');return}
  const response=await fetch('/api/auth/set-password',{
    method:'POST',
    headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({password})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){toast(data.error||'Could not set password');return}
  toast('Password updated');
}
async function logout(){await sb.auth.signOut()}

async function loadCloud(){
  const uid=currentUser(); if(!uid)return;
  const [{data:apps,error:ae},{data:projects,error:pe},{data:features,error:fe},{data:agentNotes,error:ne}]=await Promise.all([
    sb.from('applications').select('*').order('sort_order').order('name'),
    sb.from('projects').select('*').order('name'),
    sb.from('features').select('*').order('updated_at',{ascending:false}),
    sb.from('agent_notes').select('*').order('created_at',{ascending:false})
  ]);
  if(ae||pe||fe){toast((ae||pe||fe).message);return}
  state={applications:apps||[],projects:projects||[],features:features||[],agentNotes:ne?[]:(agentNotes||[])};

  if(state.applications.length===0 && state.projects.length===0 && state.features.length===0){
    await seedLegacyBuildlist();
    return;
  }

  render();
}

async function seedLegacyBuildlist(){
  const uid=currentUser();
  const appNames=['After Effects','Cinema 4D','Standalone / Web'];
  const {data:apps,error:appErr}=await sb.from('applications')
    .insert(appNames.map((name,i)=>({user_id:uid,name,sort_order:i})))
    .select();
  if(appErr){toast(appErr.message);return}

  const appMap=Object.fromEntries((apps||[]).map(a=>[a.name,a.id]));
  const legacyProjects=[
    ['p-boardly','Boardly','Standalone / Web'],
    ['p-buildlist','Buildlist','Standalone / Web'],
    ['p-tooldesk','ASPECT Tool Desk','After Effects'],
    ['p-recall','AEP RECALL','After Effects'],
    ['p-typescout','ASPECT Type Scout','After Effects'],
    ['p-inspector','ASPECT Project Inspector','After Effects'],
    ['p-material','ASPECT Material Browser','Cinema 4D'],
    ['p-scenesort','ASPECT Scene Sort','Cinema 4D'],
    ['p-lightmixer','ASPECT Light Mixer','Cinema 4D'],
    ['p-hdri','ASPECT HDRI Browser','Cinema 4D'],
    ['p-snoot','ASPECT Snoot','Cinema 4D'],
    ['p-blockgen','ASPECT Block Generator','Cinema 4D']
  ];

  const {data:projects,error:projectErr}=await sb.from('projects')
    .insert(legacyProjects.map(([legacy_id,name,app])=>({
      user_id:uid,
      application_id:appMap[app],
      name,
      branch:'main',
      agent_instructions:'',
      repo_url:'',
      local_path:'',
      legacy_id
    })))
    .select();
  if(projectErr){
    // Older schema may not have legacy_id yet; retry without it.
    const {data:retryProjects,error:retryErr}=await sb.from('projects')
      .insert(legacyProjects.map(([,name,app])=>({
        user_id:uid,
        application_id:appMap[app],
        name,
        branch:'main',
        agent_instructions:'',
        repo_url:'',
        local_path:'',
      ready_for_agent:false
    })))
      .select();
    if(retryErr){toast(retryErr.message);return}
    return seedLegacyFeatures(uid,retryProjects||[],legacyProjects);
  }
  return seedLegacyFeatures(uid,projects||[],legacyProjects);
}

async function seedLegacyFeatures(uid,projects,legacyProjects){
  const byName=Object.fromEntries(projects.map(p=>[p.name,p.id]));
  const now=new Date();
  const ago=ms=>new Date(now.getTime()-ms).toISOString();
  const rows=[
    {
      project_id:byName['Boardly'],
      area:'Library',
      title:'Import complete Finder folder hierarchies',
      status:'Next',
      priority:'High',
      tags:['import','organization'],
      notes:'Import a complete folder hierarchy from Finder and recreate the same structure in the project library.',
      acceptance:'Folders and images appear in the same hierarchy and remain easy to reorganize.',
      version:'',
      created_at:ago(600000),
      updated_at:ago(600000)
    },
    {
      project_id:byName['Boardly'],
      area:'Library',
      title:'True drag-and-drop organization',
      status:'Now',
      priority:'High',
      tags:['drag-drop','organization'],
      notes:'Move images and folders naturally with drag and drop instead of using clunky move controls.',
      acceptance:'Items can be dragged between folders and reordered directly.',
      version:'',
      created_at:ago(500000),
      updated_at:ago(500000)
    },
    {
      project_id:byName['Boardly'],
      area:'Board',
      title:'Target frame for board export resolution',
      status:'Next',
      priority:'Medium',
      tags:['export','layout'],
      notes:'Show a clear frame representing the target export resolution while working on a board.',
      acceptance:'Frame size is editable and export matches it exactly.',
      version:'',
      created_at:ago(400000),
      updated_at:ago(400000)
    },
    {
      project_id:byName['ASPECT Material Browser'],
      area:'Library',
      title:'Better searchable material categorization',
      status:'Now',
      priority:'High',
      tags:['search','organization'],
      notes:'Avoid creating a huge pile of folders. Categories should be curated, searchable, easy to browse, and support drag-and-drop promotion/organization.',
      acceptance:'Materials can be found quickly by search or category without navigating excessive auto-generated folders.',
      version:'',
      created_at:ago(300000),
      updated_at:ago(300000)
    },
    {
      project_id:byName['ASPECT Scene Sort'],
      area:'Integration',
      title:'Custom icon and ASPECT menu integration',
      status:'Done',
      priority:'Medium',
      tags:['icon','menu'],
      notes:'Scene Sort should have its own custom-designed ASPECT icon and work correctly with the ASPECT menu tools.',
      acceptance:'Custom icon displays correctly and tool appears in the ASPECT menu.',
      version:'0.2.0',
      created_at:ago(200000),
      updated_at:ago(200000)
    }
  ].map(r=>({
    ...r,
    user_id:uid,
    ready_for_agent:false,
    agent_notes:'',
    files_likely:'',
    dependencies:'',
    do_not_change:''
  })).filter(r=>r.project_id);

  const {error}=await sb.from('features').insert(rows);
  if(error){toast(error.message);return}
  toast('Old Buildlist data migrated');
  await loadCloud();
}

function visibleFeatures(){
  let a=[...state.features];
  if(activeProject){const ids=descendantProjectIds(activeProject);a=a.filter(f=>ids.has(f.project_id));}
  else if(activeApp)a=a.filter(f=>state.projects.find(p=>p.id===f.project_id)?.application_id===activeApp);
  else if(activeView==='agent')a=a.filter(f=>projectReady(f.project_id) && f.status!=='Done');
  else if(activeView!=='all')a=a.filter(f=>f.status.toLowerCase()===activeView);
  const q=$('searchInput').value.trim().toLowerCase();
  if(q)a=a.filter(f=>[f.title,projectName(f.project_id),projectAppName(f.project_id),f.area,f.status,f.priority,f.notes,f.acceptance,f.version,f.agent_notes,f.files_likely,f.dependencies,f.do_not_change,(f.tags||[]).join(' ')].join(' ').toLowerCase().includes(q));
  const pf=$('priorityFilter').value;if(pf!=='all')a=a.filter(f=>f.priority===pf);
  const sort=$('sortSelect').value, po={High:0,Medium:1,Low:2};
  if(sort==='created')a.sort((x,y)=>new Date(y.created_at)-new Date(x.created_at));
  else if(sort==='priority')a.sort((x,y)=>(po[x.priority]??9)-(po[y.priority]??9)||new Date(y.updated_at)-new Date(x.updated_at));
  else if(sort==='title')a.sort((x,y)=>x.title.localeCompare(y.title));
  else a.sort((x,y)=>new Date(y.updated_at)-new Date(x.updated_at));
  return a;
}

function featureById(id){return state.features.find(f=>f.id===id)}
function openNotesForFeature(id){return state.agentNotes.filter(n=>n.feature_id===id&&!n.resolved)}
function outcomeLabel(n){return n.outcome||'Update'}
function formatNoteTime(value){
  if(!value)return '';
  try{return new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}catch{return value}
}
function visibleAgentNotes(){
  const mode=$('noteFilter')?.value||'open';
  let notes=[...state.agentNotes];
  if(mode==='open')notes=notes.filter(n=>!n.resolved);
  else if(mode==='resolved')notes=notes.filter(n=>n.resolved);
  const q=$('searchInput').value.trim().toLowerCase();
  if(q)notes=notes.filter(n=>{
    const f=featureById(n.feature_id);
    return [n.note,n.reason,n.outcome,n.task_status,n.agent,f?.title,projectName(f?.project_id),projectAppName(f?.project_id)].join(' ').toLowerCase().includes(q);
  });
  return notes;
}
function renderAgentNotes(){
  $('pageTitle').textContent='Agent Notes';
  $('pageSub').textContent='Review feedback and completion notes from Claude, Codex, and other agents.';
  ['editProjectBtn','moveProjectBtn','deleteProjectBtn','projectAgentToggle'].forEach(id=>{const e=$(id);if(e)e.style.display='none'});
  $('noteFilter').style.display='';
  $('priorityFilter').style.display='none';
  $('sortSelect').style.display='none';
  const openCount=state.agentNotes.filter(n=>!n.resolved).length;
  $('statTotal').textContent=state.agentNotes.length;
  $('statNow').textContent=openCount;
  $('statNext').textContent=state.agentNotes.filter(n=>n.resolved).length;
  $('statDone').textContent='';
  $('statTotal').nextElementSibling.textContent='Notes';
  $('statNow').nextElementSibling.textContent='Open';
  $('statNext').nextElementSibling.textContent='Resolved';
  $('statDone').nextElementSibling.textContent='';
  const notes=visibleAgentNotes();
  const list=$('featureList');
  if(!notes.length){list.innerHTML='<div class="empty"><b>No agent notes found</b>Change the note filter or wait for Claude/Codex to write back.</div>';return}
  list.innerHTML=notes.map(n=>{
    const f=featureById(n.feature_id);
    const project=f?projectName(f.project_id):'Unknown Project';
    const app=f?projectAppName(f.project_id):'';
    const outcome=outcomeLabel(n);
    return `<article class="card note-card ${n.resolved?'note-resolved':'note-pending'} outcome-${outcome.toLowerCase()}" data-note-id="${n.id}">
      <div>
        <div class="card-context"><span class="context-app">${esc(app)}</span><span class="context-sep">›</span><span class="context-project">${esc(project)}</span>${f?'<span class="context-sep">›</span><span class="context-area">'+esc(f.title)+'</span>':''}</div>
        <div class="card-title">${esc(n.agent||'Agent')} <span class="note-time">${esc(formatNoteTime(n.created_at))}</span></div>
        <div class="card-meta"><span class="chip outcome-chip outcome-${outcome.toLowerCase()}">${esc(outcome)}</span>${n.task_status?'<span class="chip">Task: '+esc(n.task_status)+'</span>':''}<span class="chip ${n.resolved?'status-done':'status-now'}">${n.resolved?'Resolved':'Needs Review'}</span></div>
        <div class="desc note-body">${esc(n.note||'')}</div>
        ${n.reason?'<div class="note-reason"><strong>Why:</strong> '+esc(n.reason)+'</div>':''}
      </div>
      <div class="card-actions note-actions">
        ${f?'<button class="secondary note-open-feature" data-feature-id="'+f.id+'">Open Feature</button>':''}
        <button class="secondary note-toggle-resolved" data-note-id="${n.id}">${n.resolved?'Reopen':'Resolve'}</button>
      </div>
    </article>`;
  }).join('');
  list.querySelectorAll('.note-open-feature').forEach(b=>b.onclick=e=>{e.stopPropagation();openDrawer(b.dataset.featureId)});
  list.querySelectorAll('.note-toggle-resolved').forEach(b=>b.onclick=async e=>{e.stopPropagation();await toggleNoteResolved(b.dataset.noteId)});
}
async function toggleNoteResolved(id){
  const note=state.agentNotes.find(n=>n.id===id);if(!note)return;
  const next=!note.resolved;
  const {error}=await sb.from('agent_notes').update({resolved:next,resolved_at:next?new Date().toISOString():null}).eq('id',id);
  if(error){toast(error.message);return}
  await loadCloud();
  activeView='notes';activeProject=null;activeApp=null;render();
  toast(next?'Note resolved':'Note reopened');
}
function restoreStandardFilters(){
  if($('noteFilter'))$('noteFilter').style.display='none';
  if($('priorityFilter'))$('priorityFilter').style.display='';
  if($('sortSelect'))$('sortSelect').style.display='';
  const labels=[['statTotal','Total'],['statNow','Now'],['statNext','Next'],['statDone','Done']];
  labels.forEach(([id,label])=>{const el=$(id);if(el&&el.nextElementSibling)el.nextElementSibling.textContent=label});
}

function render(){renderSidebar();restoreStandardFilters();renderMain()}
function renderSidebar(){
  const ownTotals={}; state.projects.forEach(p=>ownTotals[p.id]=0); state.features.forEach(f=>ownTotals[f.project_id]=(ownTotals[f.project_id]||0)+1);
  const totalFor=id=>{let n=0;descendantProjectIds(id).forEach(pid=>n+=ownTotals[pid]||0);return n};
  const renderTree=(appId,parentId=null,depth=0)=>{
    const ps=state.projects.filter(p=>p.application_id===appId&&(p.parent_project_id||null)===parentId).sort((a,b)=>a.name.localeCompare(b.name));
    return ps.map(p=>{
      const kids=state.projects.some(x=>x.parent_project_id===p.id);
      const inherited=projectReady(p.id)&&!projectOwnReady(p.id);
      return `<div class="project-node"><button class="projectbtn ${activeProject===p.id?'active':''} ${depth?'subprojectbtn':''}" data-project="${p.id}" style="padding-left:${22+depth*16}px"><span class="dot"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>${projectOwnReady(p.id)?'<span class="project-lightning" title="Ready for Agent">⚡</span>':inherited?'<span class="project-lightning" title="Ready via parent">↳⚡</span>':''}<span class="count">${totalFor(p.id)}</span></button>${kids?renderTree(appId,p.id,depth+1):''}</div>`;
    }).join('');
  };
  const apps=[...state.applications].sort((a,b)=>{const pref=['After Effects','Cinema 4D','Standalone / Web'];const ai=pref.indexOf(a.name),bi=pref.indexOf(b.name);if(ai!==-1||bi!==-1)return (ai===-1?99:ai)-(bi===-1?99:bi);return a.name.localeCompare(b.name)});
  $('projectList').innerHTML=apps.map(app=>{const roots=state.projects.filter(p=>p.application_id===app.id&&!p.parent_project_id);const total=roots.reduce((n,p)=>n+totalFor(p.id),0);return `<div class="appgroup"><button class="apphead ${activeApp===app.id&&!activeProject?'active':''}" data-app="${app.id}"><span class="appchev">▾</span><span>${esc(app.name)}</span><span class="count">${total}</span></button>${renderTree(app.id)}</div>`}).join('');
  const counts={all:state.features.length,inbox:0,now:0,next:0,later:0,done:0,agent:state.features.filter(f=>projectReady(f.project_id)&&f.status!=='Done').length,notes:state.agentNotes.filter(n=>!n.resolved).length};
  state.features.forEach(f=>{const k=f.status.toLowerCase();if(k in counts)counts[k]++});
  Object.entries(counts).forEach(([k,v])=>{const e=$(k+'Count');if(e)e.textContent=v});
  const notesNav=document.querySelector('.navbtn[data-view="notes"]');
  if(notesNav)notesNav.classList.toggle('has-pending-notes',counts.notes>0);
  document.querySelectorAll('.navbtn').forEach(b=>b.classList.toggle('active',!activeProject&&!activeApp&&b.dataset.view===activeView));
  document.querySelectorAll('.projectbtn').forEach(b=>b.onclick=()=>{activeProject=b.dataset.project;activeApp=null;activeView='all';render()});
  document.querySelectorAll('.apphead').forEach(b=>b.onclick=()=>{activeProject=null;activeApp=b.dataset.app;activeView='all';render()});
}
function renderMain(){
  if(activeView==='notes'&&!activeProject&&!activeApp){renderAgentNotes();return}
  const arr=visibleFeatures();let title='All Features',sub='Everything you want to build, in one place.';
  if(activeProject){
    const trail=projectTrail(activeProject);
    title=projectName(activeProject);
    sub=projectAppName(activeProject)+' · '+(trail.length>1?trail.map(p=>p.name).join(' › ')+' · Includes subproject features.':'Feature backlog for this project and its subprojects.');
  }
  else if(activeApp){title=appName(activeApp);sub='All projects and features in this application.'}
  else if(activeView==='agent'){title='Agent Queue';sub='All non-Done features from projects marked Ready for Agent.'}
  else if(activeView!=='all'){title=activeView[0].toUpperCase()+activeView.slice(1);sub={inbox:'Ideas you have not prioritized yet.',now:'Features you want to focus on now.',next:'Important features queued up next.',later:'Good ideas worth keeping for later.',done:'Features you have finished.'}[activeView]}
  $('pageTitle').textContent=title;$('pageSub').textContent=sub;
  const agentToggle=$('projectAgentToggle');
  if(agentToggle){
    if(activeProject){
      const own=projectOwnReady(activeProject), inherited=projectReady(activeProject)&&!own;
      agentToggle.style.display='';
      agentToggle.textContent=own?'⚡ Agent Reading Project':inherited?'↳⚡ Ready via Parent':'⚡ Ready for Agent';
      agentToggle.classList.toggle('agent-on',own||inherited);
      agentToggle.disabled=inherited;
    }else{
      agentToggle.style.display='none';
      agentToggle.classList.remove('agent-on');
      agentToggle.disabled=false;
    }
  }
  const editProjectBtn=$('editProjectBtn'), moveProjectBtn=$('moveProjectBtn'), deleteProjectBtn=$('deleteProjectBtn');
  if(editProjectBtn)editProjectBtn.style.display=activeProject?'':'none';
  if(moveProjectBtn)moveProjectBtn.style.display=activeProject?'':'none';
  if(deleteProjectBtn)deleteProjectBtn.style.display=activeProject?'':'none';
  $('statTotal').textContent=state.features.length;$('statNow').textContent=state.features.filter(f=>f.status==='Now').length;$('statNext').textContent=state.features.filter(f=>f.status==='Next').length;$('statDone').textContent=state.features.filter(f=>f.status==='Done').length;
  const list=$('featureList');if(!arr.length){list.innerHTML='<div class="empty"><b>No features found</b>Try another search/filter or add a new feature.</div>';return}
  list.innerHTML=arr.map(f=>{const pending=openNotesForFeature(f.id);return `<article class="card ${pending.length?'has-agent-notes':''}" data-id="${f.id}"><div><div class="card-context"><span class="context-app">${esc(projectAppName(f.project_id))}</span><span class="context-sep">›</span><span class="context-project">${esc(projectTrail(f.project_id).map(p=>p.name).join(' › '))}</span>${f.area?`<span class="context-sep">›</span><span class="context-area">${esc(f.area)}</span>`:''}</div><div class="card-title">${esc(f.title)}</div><div class="card-meta"><span class="chip status-${f.status.toLowerCase()}">${esc(f.status)}</span><span class="chip priority-${f.priority.toLowerCase()}">${esc(f.priority)}</span>${pending.length?'<span class="chip pending-note-chip">✎ '+pending.length+' Agent Note'+(pending.length===1?'':'s')+'</span>':''}${projectReady(f.project_id)?'<span class="chip ready-chip">⚡ Agent Project</span>':''}${(f.tags||[]).slice(0,4).map(t=>`<span class="chip">#${esc(t)}</span>`).join('')}</div>${f.notes?`<div class="desc">${esc(f.notes)}</div>`:''}</div><div class="card-actions"><button class="tiny edit" title="Edit">✎</button></div></article>`}).join('');
  list.querySelectorAll('.card').forEach(c=>c.onclick=()=>openDrawer(c.dataset.id));
}
function projectOptions(selected){return state.projects.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(projectAppName(p.id))} — ${esc(projectTrail(p.id).map(x=>x.name).join(' › '))}</option>`).join('')}
function openDrawer(id=null){
  editingId=id;const f=id?state.features.find(x=>x.id===id):null;$('drawerTitle').textContent=f?'Edit Feature':'Add Feature';
  $('fTitle').value=f?.title||'';$('fProject').innerHTML=projectOptions(f?.project_id||activeProject||state.projects[0]?.id);$('fArea').value=f?.area||'';$('fStatus').value=f?.status||'Inbox';$('fPriority').value=f?.priority||'Medium';$('fTags').value=(f?.tags||[]).join(', ');$('fNotes').value=f?.notes||'';$('fAcceptance').value=f?.acceptance||'';$('fVersion').value=f?.version||'';$('fAgentNotes').value=f?.agent_notes||'';$('fFilesLikely').value=f?.files_likely||'';$('fDependencies').value=f?.dependencies||'';$('fDoNotChange').value=f?.do_not_change||'';$('deleteFeature').style.display=f?'block':'none';$('overlay').classList.add('show');$('drawer').classList.add('show');setTimeout(()=>$('fTitle').focus(),100)
}
function closeDrawer(){$('overlay').classList.remove('show');$('drawer').classList.remove('show');editingId=null}
async function saveFeature(){
  const title=$('fTitle').value.trim();if(!title){toast('Give the feature a name');return}
  const row={user_id:currentUser(),project_id:$('fProject').value,area:$('fArea').value.trim(),title,status:$('fStatus').value,priority:$('fPriority').value,tags:$('fTags').value.split(',').map(x=>x.trim()).filter(Boolean),notes:$('fNotes').value.trim(),acceptance:$('fAcceptance').value.trim(),version:$('fVersion').value.trim(),agent_notes:$('fAgentNotes').value.trim(),files_likely:$('fFilesLikely').value.trim(),dependencies:$('fDependencies').value.trim(),do_not_change:$('fDoNotChange').value.trim(),updated_at:new Date().toISOString()};
  const q=editingId?sb.from('features').update(row).eq('id',editingId):sb.from('features').insert(row); const {error}=await q;if(error){toast(error.message);return}const wasEditing=!!editingId;closeDrawer();await loadCloud();toast(wasEditing?'Feature updated':'Feature added')
}
async function deleteFeature(){if(!editingId)return;if(!confirm('Delete this feature?'))return;const {error}=await sb.from('features').delete().eq('id',editingId);if(error){toast(error.message);return}closeDrawer();await loadCloud();toast('Feature deleted')}

function applicationOptions(selected=''){const known=[...state.applications];return known.map(a=>`<option value="${a.id}" ${a.id===selected?'selected':''}>${esc(a.name)}</option>`).join('')+'<option value="__custom">New application…</option>'}
function parentProjectOptions(appId,selected=''){
  const excluded=editingProjectId?descendantProjectIds(editingProjectId):new Set();
  return '<option value="">None — top-level project</option>'+state.projects.filter(p=>p.application_id===appId&&!excluded.has(p.id)).sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(projectTrail(p.id).map(x=>x.name).join(' › '))}</option>`).join('');
}
function refreshParentProjectOptions(selected=''){
  const appId=$('projectApp').value;
  $('projectParent').innerHTML=appId&&appId!=='__custom'?parentProjectOptions(appId,selected):'<option value="">None — top-level project</option>';
}
function showProjectModal(show=true,projectId=null){
  $('modalOverlay').classList.toggle('show',show);$('projectModal').classList.toggle('show',show);
  if(!show){editingProjectId=null;return}
  editingProjectId=projectId;
  const p=projectId?projectById(projectId):null;
  $('projectModal').querySelector('h3').textContent=p?'Edit Project':'Add Project';
  $('saveProject').textContent=p?'Save Changes':'Add Project';
  $('deleteProjectModalBtn').style.display=p?'':'none';
  $('projectName').value=p?.name||'';
  $('projectApp').innerHTML=applicationOptions(p?.application_id||activeApp||'');
  if(p?.application_id)$('projectApp').value=p.application_id;else if(activeApp)$('projectApp').value=activeApp;
  $('customAppName').value='';$('customAppField').style.display='none';
  refreshParentProjectOptions(p?.parent_project_id||'');
  $('projectRepo').value=p?.repo_url||'';
  $('projectBranch').value=p?.branch||'main';
  $('projectLocalPath').value=p?.local_path||'';
  $('projectAgentInstructions').value=p?.agent_instructions||'';
  $('projectReadyAgent').checked=!!p?.ready_for_agent;
  setTimeout(()=>$('projectName').focus(),80);
}
async function addProject(){
  const name=$('projectName').value.trim();if(!name){toast('Give the project a name');return}
  let appId=$('projectApp').value;if(appId==='__custom'){const appName=$('customAppName').value.trim();if(!appName){toast('Give the application a name');return}const {data,error}=await sb.from('applications').insert({user_id:currentUser(),name:appName}).select().single();if(error){toast(error.message);return}appId=data.id}
  const parentId=$('projectParent').value||null;
  const row={user_id:currentUser(),application_id:appId,parent_project_id:parentId,name,repo_url:$('projectRepo').value.trim(),branch:$('projectBranch').value.trim()||'main',local_path:$('projectLocalPath').value.trim(),agent_instructions:$('projectAgentInstructions').value.trim(),ready_for_agent:$('projectReadyAgent').checked,updated_at:new Date().toISOString()};
  const q=editingProjectId?sb.from('projects').update(row).eq('id',editingProjectId):sb.from('projects').insert(row).select().single();
  const {data,error}=await q;if(error){toast(error.message);return}
  const wasEditing=!!editingProjectId;
  const savedId=editingProjectId||data?.id;
  showProjectModal(false);activeProject=savedId;activeApp=null;await loadCloud();toast(wasEditing?'Project updated':'Project added')
}


async function deleteProject(projectId=editingProjectId||activeProject){
  if(!projectId)return;
  const p=projectById(projectId); if(!p)return;

  const directChildren=state.projects.filter(x=>x.parent_project_id===projectId);
  const ownFeatures=state.features.filter(f=>f.project_id===projectId);
  const childText=directChildren.length?directChildren.length+' subproject'+(directChildren.length===1?'':'s')+' will move up one level. ':'';
  const featureText=ownFeatures.length?ownFeatures.length+' feature'+(ownFeatures.length===1?'':'s')+' in this project will be permanently deleted. ':'';
  const warning=(childText+featureText+'Delete "'+p.name+'"?').trim();

  if(!confirm(warning))return;

  if(directChildren.length){
    const {error:childErr}=await sb.from('projects').update({
      parent_project_id:p.parent_project_id||null,
      updated_at:new Date().toISOString()
    }).in('id',directChildren.map(x=>x.id));
    if(childErr){toast(childErr.message);return}
  }

  const {error}=await sb.from('projects').delete().eq('id',projectId);
  if(error){toast(error.message);return}

  showProjectModal(false);
  activeProject=p.parent_project_id||null;
  activeApp=p.parent_project_id?null:p.application_id;
  await loadCloud();
  toast('Project deleted');
}

function moveActiveProject(){
  if(!activeProject)return;
  showProjectModal(true,activeProject);
  setTimeout(()=>{
    const field=$('projectParent');
    if(field){field.focus();field.scrollIntoView({block:'center',behavior:'smooth'})}
  },120);
}

async function toggleActiveProjectAgent(){
  if(!activeProject)return;
  const project=state.projects.find(p=>p.id===activeProject); if(!project)return;
  const next=!projectOwnReady(activeProject);
  const {error}=await sb.from('projects').update({ready_for_agent:next,updated_at:new Date().toISOString()}).eq('id',activeProject);
  if(error){toast(error.message);return}
  await loadCloud();
  toast(next?'Project is now Ready for Agent':'Project removed from Agent Queue');
}

async function ensureDefaultApplications(){
  if(state.applications.length)return;
  const names=['After Effects','Cinema 4D','Standalone / Web'];
  const {error}=await sb.from('applications').insert(names.map((name,i)=>({user_id:currentUser(),name,sort_order:i})));if(!error)await loadCloud();
}
async function importLegacyObject(x){
  if(!x||!Array.isArray(x.projects)||!Array.isArray(x.features))throw new Error('Not a valid Buildlist backup');
  await ensureDefaultApplications();
  const appByName={};state.applications.forEach(a=>appByName[a.name]=a.id);
  for(const p of x.projects){const an=p.app||'Standalone / Web';if(!appByName[an]){const {data,error}=await sb.from('applications').insert({user_id:currentUser(),name:an}).select().single();if(error)throw error;appByName[an]=data.id;state.applications.push(data)}}
  const idMap={};
  for(const p of x.projects){const {data,error}=await sb.from('projects').insert({user_id:currentUser(),application_id:appByName[p.app||'Standalone / Web'],name:p.name,branch:'main',ready_for_agent:false}).select().single();if(error)throw error;idMap[p.id]=data.id}
  if(x.features.length){const rows=x.features.map(f=>({user_id:currentUser(),project_id:idMap[f.projectId],area:f.area||'',title:f.title,status:f.status||'Inbox',priority:f.priority||'Medium',tags:f.tags||[],notes:f.notes||'',acceptance:f.acceptance||'',version:f.version||'',ready_for_agent:false,created_at:new Date(f.created||Date.now()).toISOString(),updated_at:new Date(f.updated||Date.now()).toISOString()})).filter(r=>r.project_id);const {error}=await sb.from('features').insert(rows);if(error)throw error}
  await loadCloud();
}
function exportData(){const payload={applications:state.applications,projects:state.projects,features:state.features,exportedAt:new Date().toISOString()};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Buildlist-cloud-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href);toast('Backup exported')}
function importData(file){const r=new FileReader();r.onload=async()=>{try{const x=JSON.parse(r.result);if(Array.isArray(x.applications)){toast('Cloud backup import is not enabled yet; use a legacy Buildlist export for migration.');return}await importLegacyObject(x);toast('Local Buildlist imported to cloud')}catch(e){toast(e.message||'Import failed')}};r.readAsText(file)}

$('authButton').onclick=login;
$('passwordSetupToggle').onclick=togglePasswordSetup;
$('setupPasswordButton').onclick=setupPassword;
$('authEmail').onkeydown=e=>{if(e.key==='Enter')login()};
$('authPassword').onkeydown=e=>{if(e.key==='Enter')login()};
$('setPasswordBtn').onclick=setPassword;
$('logoutBtn').onclick=logout;
document.querySelectorAll('.navbtn').forEach(b=>b.onclick=()=>{activeProject=null;activeApp=null;activeView=b.dataset.view;render()});
$('newFeatureBtn').onclick=()=>openDrawer();$('closeDrawer').onclick=closeDrawer;$('cancelFeature').onclick=closeDrawer;$('overlay').onclick=closeDrawer;$('saveFeature').onclick=saveFeature;$('deleteFeature').onclick=deleteFeature;
$('projectAgentToggle').onclick=toggleActiveProjectAgent;
$('searchInput').oninput=renderMain;$('priorityFilter').onchange=renderMain;$('sortSelect').onchange=renderMain;$('noteFilter').onchange=renderAgentNotes;
$('addProjectBtn').onclick=()=>showProjectModal(true);$('newProjectTopBtn').onclick=()=>showProjectModal(true);$('editProjectBtn').onclick=()=>{if(activeProject)showProjectModal(true,activeProject)};$('moveProjectBtn').onclick=moveActiveProject;$('deleteProjectBtn').onclick=()=>deleteProject(activeProject);$('deleteProjectModalBtn').onclick=()=>deleteProject(editingProjectId);$('projectApp').onchange=e=>{$('customAppField').style.display=e.target.value==='__custom'?'block':'none';refreshParentProjectOptions();if(e.target.value==='__custom')setTimeout(()=>$('customAppName').focus(),40)};$('cancelProject').onclick=()=>showProjectModal(false);$('modalOverlay').onclick=()=>showProjectModal(false);$('saveProject').onclick=addProject;$('projectName').onkeydown=e=>{if(e.key==='Enter')addProject()};
$('exportBtn').onclick=exportData;$('importBtn').onclick=()=>$('importFile').click();$('importFile').onchange=e=>{if(e.target.files[0])importData(e.target.files[0]);e.target.value=''};
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('searchInput').focus()}if(e.key==='Escape'){closeDrawer();showProjectModal(false)}});
init();
