# Connect Codex to local DevPilot

This flow works with Codex on the same computer as DevPilot. Accounts, projects and OAuth credentials use local SQLite only. It does not contact Supabase. Public plugins and hosted ChatGPT connections are outside this slice.

1. Run **start-dev.bat** and keep its window open. If an older instance is running, stop it with Ctrl+C first.
2. Open your project and click **Connect AI → Copy server URL**.
3. In Codex, open **Settings → MCP servers → Add server**. Choose **Streamable HTTP**, name it **DevPilot**, and paste the URL. Leave bearer-token and header fields empty.
4. Save the server, then click **Authenticate**. If Codex requests a restart, restart it first.
5. In the browser, sign into the local workspace with **dev / dev**. Select your project, choose **Read only** or **Read and edit items**, then click **Authorize connection**.
6. Return to Codex and start a new chat. Ask: **“Use DevPilot to show the connected project and its backlog.”**

No manual configuration-file editing or token copying is needed. The normal URL is `http://127.0.0.1:4202/mcp`. Keep this local server private; it is not a hosted endpoint.

## Start work from a story

Local DevPilot can also start Codex itself. This is separate from the MCP connection above; assigning the next actor alone still does not start a run.

1. Install Codex on the computer running DevPilot and sign in with ChatGPT. On Windows, DevPilot automatically discovers the registered Codex desktop app when Codex is missing from the launcher's PATH. The CLI is also supported (`codex login`), including its official npm command shim. DevPilot uses that sign-in; this integration does not set up an API key. To choose a specific installation, set `DEVPILOT_CODEX_BIN` to the full path of its executable before starting DevPilot.
2. Restart DevPilot after updating the local API. Select your project and open **Connect AI → Run Codex from DevPilot**, enter the absolute local project-folder path and click **Save Codex connection**. This folder is shared by all stories in that project.
3. Save unfinished story edits and post unfinished notes, then click **Work on this story**. Codex receives the saved story, acceptance checklist and notes, and runs in that folder with workspace-write sandboxing and approval requests enabled.
4. Watch the story's notes for progress. Answer questions and approve once or decline proposed commands/file changes in **Codex work**. Replies and decisions are recorded on the story. Unsupported or secret-input requests are not approved automatically.
5. Use **Stop Codex work** to stop an active run. Partial file changes remain available for review. After a question or an interruption, add a follow-up and choose **Continue work on this story** to resume its saved Codex conversation.

Completed work moves to **Ready for Review**, assigned to **Me**, with testing steps. Codex never marks it Done. Questions, failures and interrupted runs also return the next action to you. API restarts clear pending approvals; continue the story to resume its conversation. Only one run can use the same project or configured folder at a time. Changing folders starts a fresh conversation.

Keep DevPilot and its local API running while work is active. Run history, thread IDs and notes persist in SQLite; the stdio agent process does not survive API shutdown. A missing CLI, missing ChatGPT sign-in or App Server startup failure appears as a failed run on the story. Browser interaction and frontend tests remain the user's responsibility.

The launcher keeps the API process stable during agent work. Backend file edits do not restart it automatically. After Codex finishes, restart the launcher to apply backend changes; restarting during a run interrupts that run. Frontend changes still reload automatically.

Protocol reference: [Codex App Server](https://learn.chatgpt.com/docs/app-server).

With edit access, try **“Add an idea titled ‘Filter the board by type’, medium priority”**, then **“Move that idea to To Do and add a note explaining the goal.”** Click **Refresh items** beside the DevPilot board search to see changes made by Codex.

## Project access

| Permission | Tools |
| --- | --- |
| Read only | `get_project`, `list_items`, `get_item` |
| Read and edit | Read tools plus `create_item`, `update_item`, `add_note` |

Each authorization accesses exactly one project. Other projects' item IDs are rejected. No arbitrary SQL or project deletion is exposed. Lists are paginated; item details include the latest 20 notes and a total note count.

Item tools also support `next_actor` (`user`, `codex`, or `null`), `next_action`, and `acceptance_criteria` (an array of `{text, completed}`). Replace the checklist array when editing it; omitted update fields are preserved. The existing `testing` status key displays as **Ready for Review**. Record a concrete handoff action and leave the next actor as `user` when asking for acceptance. Never mark Done until the user has tested and explicitly approved the result. A completed checklist or passing automated tests alone is not approval. Restart the MCP connection or start a new chat if a client still shows the older tool schemas.

The browser asks for credentials before showing project names. Authorization uses S256 PKCE and a single-use, short-lived code. Access tokens expire after one hour; refresh tokens rotate and expire after 30 days. Token hashes and client registrations persist in SQLite. Detecting reuse of a consumed refresh token revokes that connection and requires fresh authentication.

## Manage and revoke

Open **Connect AI → Refresh connections** after authenticating. The list shows authorizations for the currently selected project, permissions and last request time. **Not used yet** means no authenticated MCP request has reached the project.

**Revoke** immediately denies subsequent MCP operations and refreshes. Deleting a project removes its grants too. Restarting the API preserves authorized connections and valid browser API sessions, but clears unfinished OAuth sign-in flows. Local browser logins expire after eight hours or explicit sign-out.

Existing manually configured bearer-token connections continue working. To switch, remove the old server or its Authorization header through Codex's MCP settings, add the URL with no headers, and authenticate. Revoke the old connection after confirming the new one works. A bearer header can bypass the OAuth prompt, so do not retain it on the OAuth server entry.

## Troubleshooting

- **No Authenticate option:** save a Streamable HTTP entry without bearer headers, then restart its server or Codex. The CLI alternative is `codex mcp login <server-name>` for an already-added server.
- **Connection refused:** keep `start-dev.bat` running.
- **Expired sign-in or interrupted restart:** start authentication again in Codex. Unfinished forms and codes are intentionally temporary.
- **No projects:** create one in DevPilot, then authenticate again.
- **Tools missing in an existing chat:** start a new chat after authenticating. Read-only grants intentionally expose three tools.
- **Changes not visible:** click **Refresh items**. The board does not continuously poll for external updates.
- **Not used yet:** ask Codex to list the backlog, then refresh the project connections list.

References: [Codex MCP setup](https://learn.chatgpt.com/docs/extend/mcp), [MCP OAuth authentication](https://developers.openai.com/plugins/build/auth).
