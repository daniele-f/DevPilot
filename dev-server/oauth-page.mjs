export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);

export function consentPage(flow, projects = [], error = "") {
  const e = escapeHtml;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect DevPilot</title>
  <style>
  :root{color-scheme:light dark;--bg:#f4f5f7;--panel:#fff;--text:#20232a;--muted:#606570;--line:#d9dce2;--accent:#a9e77f}
  @media(prefers-color-scheme:dark){:root{--bg:#101214;--panel:#191c20;--text:#f1f2f4;--muted:#a5aab5;--line:#363b43}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 system-ui,sans-serif;padding:32px 18px}
  main{max-width:460px;margin:5vh auto;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:30px}
  .eyebrow{font-size:11px;letter-spacing:.16em;color:var(--muted)}h1{font-size:26px;line-height:1.25;margin:20px 0 12px}p{color:var(--muted);font-size:13px}
  label{display:block;margin:18px 0 6px;font-size:13px}input,select{width:100%;font:inherit;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:7px;padding:10px}
  button{font:inherit;font-size:13px;cursor:pointer;padding:11px 17px;border-radius:7px;border:1px solid var(--line);background:var(--accent);color:#16200f;margin:20px 8px 0 0}button.secondary{background:var(--bg);color:var(--text)}
  .error{color:#d44c4c}small{display:block;color:var(--muted);font-size:11px;margin-top:22px}a{color:inherit}
  </style></head><body><main><div class="eyebrow">DEVPILOT · LOCAL CONNECTION</div>
  <h1>${flow.userId ? "Authorize project access" : "Sign in to DevPilot"}</h1>
  <p><strong>${e(flow.client.client_name || "MCP client")}</strong> wants to connect to your local workspace.</p>
  ${error ? `<p class="error" role="alert">${e(error)}</p>` : ""}
  <form method="post" action="/oauth/consent">
  <input type="hidden" name="flow" value="${e(flow.id)}"><input type="hidden" name="csrf" value="${e(flow.csrf)}">
  ${flow.userId ? `
    <label for="project">Project</label><select id="project" name="project_id" required>${projects.map(p => `<option value="${e(p.id)}">${e(p.name)}</option>`).join("")}</select>
    <label for="permission">Project access</label><select id="permission" name="permission"><option value="read">Read only</option>${flow.params.scopes?.length && !flow.params.scopes.includes("edit") ? "" : '<option value="edit">Read and edit items</option>'}</select>
    <p>Read access includes items and notes. Edit access also allows creating ideas and tasks, changing items, and adding notes. Project deletion is never exposed.</p>
    ${projects.length ? '<button name="action" value="allow">Authorize connection</button>' : '<p>Create a project in DevPilot, then start authentication again.</p>'}
  ` : `
    <label for="username">Username</label><input id="username" name="username" placeholder="Username" autocomplete="username" required autofocus>
    <label for="password">Password</label><input id="password" name="password" placeholder="Password" type="password" autocomplete="current-password" required>
    <button name="action" value="signin">Continue</button>
  `}
  <button class="secondary" name="action" value="deny" formnovalidate>Cancel</button>
  </form><small>Only this computer · SQLite storage · No Supabase connection.<br>Return address: ${e(new URL(flow.params.redirectUri).origin)}<br>You can revoke access in DevPilot → Connect AI.</small>
  </main></body></html>`;
}
