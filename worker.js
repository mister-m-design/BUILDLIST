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
    fetch(`${base}/rest/v1/features?user_id=eq.${encodeURIComponent(user)}&ready_for_agent=eq.true&status=neq.Done&select=*`, { headers })
  ]);

  if (![appsR, projectsR, featuresR].every(r => r.ok)) {
    return Response.json({ error: "Database query failed" }, { status: 502 });
  }

  const [apps, projects, features] = await Promise.all([
    appsR.json(), projectsR.json(), featuresR.json()
  ]);

  const appMap = Object.fromEntries(apps.map(a => [a.id, a]));
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]));

  const tasks = features.map(f => {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/agent/tasks" && request.method === "GET") {
      return agentTasks(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};
