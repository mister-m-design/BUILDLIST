async function agentTasks(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const expected = `Bearer ${env.AGENT_FEED_TOKEN || ""}`;
  if (!env.AGENT_FEED_TOKEN || auth !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const user = env.AGENT_USER_ID;
  if (!base || !key || !user) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const [appsR, projectsR, featuresR] = await Promise.all([
    fetch(`${base}/rest/v1/applications?user_id=eq.${encodeURIComponent(user)}&select=*`, { headers }),
    fetch(`${base}/rest/v1/projects?user_id=eq.${encodeURIComponent(user)}&select=*`, { headers }),
    fetch(`${base}/rest/v1/features?user_id=eq.${encodeURIComponent(user)}&status=neq.Done&select=*`, { headers })
  ]);

  if (![appsR, projectsR, featuresR].every(r => r.ok)) {
    return Response.json({ error: "Database query failed" }, { status: 502 });
  }

  const [apps, projects, features] = await Promise.all([
    appsR.json(), projectsR.json(), featuresR.json()
  ]);

  const appMap = Object.fromEntries(apps.map(a => [a.id, a]));
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]));

  const readyProjects = new Set(projects.filter(p => p.ready_for_agent).map(p => p.id));
  const tasks = features.filter(f => readyProjects.has(f.project_id)).map(f => {
    const p = projectMap[f.project_id] || {};
    const a = appMap[p.application_id] || {};
    return {
      id: f.id,
      application: a.name || "Other",
      project: p.name || "Unknown",
      repository: p.repo_url || "",
      branch: p.branch || "main",
      localPath: p.local_path || "",
      projectAgentInstructions: p.agent_instructions || "",
      area: f.area || "",
      title: f.title,
      status: f.status,
      priority: f.priority,
      tags: f.tags || [],
      description: f.notes || "",
      acceptanceCriteria: f.acceptance || "",
      agentNotes: f.agent_notes || "",
      filesLikelyInvolved: f.files_likely || "",
      dependencies: f.dependencies || "",
      doNotChange: f.do_not_change || "",
      updatedAt: f.updated_at
    };
  });

  return Response.json(
    { generatedAt: new Date().toISOString(), count: tasks.length, tasks },
    { headers: { "Cache-Control": "no-store" } }
  );
}



async function updateAgentTask(request, env, taskId) {
  const auth = request.headers.get("Authorization") || "";
  const expected = `Bearer ${env.AGENT_FEED_TOKEN || ""}`;
  if (!env.AGENT_FEED_TOKEN || auth !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const user = env.AGENT_USER_ID;
  if (!base || !key || !user) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const allowedStatuses = new Set(["Inbox", "Now", "Next", "Later", "Done"]);
  const status = body?.status;
  if (status !== undefined && !allowedStatuses.has(status)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }

  const note = body?.note === undefined ? undefined : String(body.note).trim();
  const agent = body?.agent === undefined ? undefined : String(body.agent).trim();

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };

  // Verify the task belongs to this user and is in a project exposed to agents.
  const featureR = await fetch(
    `${base}/rest/v1/features?id=eq.${encodeURIComponent(taskId)}&user_id=eq.${encodeURIComponent(user)}&select=id,project_id,status,agent_notes`,
    { headers }
  );
  if (!featureR.ok) {
    return Response.json({ error: "Task lookup failed" }, { status: 502 });
  }
  const features = await featureR.json();
  const feature = features[0];
  if (!feature) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  const projectR = await fetch(
    `${base}/rest/v1/projects?id=eq.${encodeURIComponent(feature.project_id)}&user_id=eq.${encodeURIComponent(user)}&ready_for_agent=eq.true&select=id`,
    { headers }
  );
  if (!projectR.ok) {
    return Response.json({ error: "Project lookup failed" }, { status: 502 });
  }
  const projects = await projectR.json();
  if (!projects.length) {
    return Response.json({ error: "Project is not Ready for Agent" }, { status: 403 });
  }

  const update = { updated_at: new Date().toISOString() };
  if (status !== undefined) update.status = status;

  if (note !== undefined || agent !== undefined) {
    const stamp = new Date().toISOString();
    const who = agent || "Agent";
    const message = note || "Updated task";
    const entry = `[${stamp}] ${who}: ${message}`;
    const existing = String(feature.agent_notes || "").trim();
    update.agent_notes = existing ? `${existing}\n${entry}` : entry;
  }

  const updateR = await fetch(
    `${base}/rest/v1/features?id=eq.${encodeURIComponent(taskId)}&user_id=eq.${encodeURIComponent(user)}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify(update)
    }
  );

  if (!updateR.ok) {
    let detail = "Task update failed";
    try {
      const data = await updateR.json();
      detail = data?.message || data?.error || detail;
    } catch {}
    return Response.json({ error: detail }, { status: updateR.status });
  }

  const rows = await updateR.json();
  return Response.json({ ok: true, task: rows[0] || { id: taskId, ...update } });
}

async function setPassword(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const expected = `Bearer ${env.AGENT_FEED_TOKEN || ""}`;
  if (!env.AGENT_FEED_TOKEN || auth !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const user = env.AGENT_USER_ID;
  if (!base || !key || !user) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const password = String(body?.password || "");
  if (password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const response = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(user)}`, {
    method: "PUT",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password })
  });

  if (!response.ok) {
    let detail = "Password update failed";
    try {
      const data = await response.json();
      detail = data?.msg || data?.message || data?.error_description || detail;
    } catch {}
    return Response.json({ error: detail }, { status: response.status });
  }

  return Response.json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/agent/tasks" && request.method === "GET") {
      return agentTasks(request, env);
    }
    const taskMatch = url.pathname.match(/^\/api\/agent\/tasks\/([^/]+)$/);
    if (taskMatch && request.method === "PATCH") {
      return updateAgentTask(request, env, taskMatch[1]);
    }
    if (url.pathname === "/api/auth/set-password" && request.method === "POST") {
      return setPassword(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};
