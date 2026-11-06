// A tiny stand-in for Supabase used only by the tests. It follows the same rules as
// supabase/schema.sql: you only see diaries you belong to, invites work once, and the
// server stamps who changed an entry and when.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";

export function startMock(port, distDir) {
  const users = {}, diaries = {}, members = [], invites = {}, entries = {};
  let clock = Date.now();
  const now = () => new Date(clock = Math.max(clock + 1, Date.now())).toISOString();
  const isMember = (d, u) => members.some(m => m.diary_id === d && m.user_id === u);
  const ops = {
    signUp({ email, password }) { if (Object.values(users).some(u => u.email === email)) throw "User already registered"; const id = randomUUID(); users[id] = { id, email, password }; return { userId: id, email }; },
    signIn({ email, password }) { const u = Object.values(users).find(u => u.email === email && u.password === password); if (!u) throw "Invalid login credentials"; return { userId: u.id, email }; },
    myDiaries(_, me) { return members.filter(m => m.user_id === me); },
    createDiary({ label }, me) { const id = randomUUID(); diaries[id] = { id }; members.push({ diary_id: id, user_id: me, label, role: "owner", joined_at: now() }); return id; },
    createInvite({ d }, me) { if (!isMember(d, me)) throw "Not a member of this diary"; const c = Math.random().toString(36).slice(2, 10).toUpperCase(); invites[c] = { d }; return c; },
    joinDiary({ code, label }, me) { const inv = invites[code.trim().toUpperCase()]; if (!inv) throw "That invite code was not found"; if (inv.used && inv.used !== me) throw "That invite code has already been used"; inv.used = me; if (!isMember(inv.d, me)) members.push({ diary_id: inv.d, user_id: me, label, role: "carer", joined_at: now() }); return inv.d; },
    members({ d }, me) { if (!isMember(d, me)) return []; return members.filter(m => m.diary_id === d).map(({ user_id, label, role }) => ({ user_id, label, role })); },
    setLabel({ d, label }, me) { const m = members.find(m => m.diary_id === d && m.user_id === me); if (m) m.label = label; return null; },
    upsert({ rows }, me) { return rows.map(r => { if (!isMember(r.diary_id, me)) throw "row-level security"; const old = entries[r.id]; const t = now(); entries[r.id] = { ...r, created_by: old ? old.created_by : me, created_at: old ? old.created_at : t, updated_by: me, updated_at: t, diary_id: old ? old.diary_id : r.diary_id }; return entries[r.id]; }); },
    pull({ d, since }, me) { if (!isMember(d, me)) return []; return Object.values(entries).filter(e => e.diary_id === d && (!since || e.updated_at > since)).sort((a, b) => a.updated_at.localeCompare(b.updated_at)); },
    deleteDiary({ d }, me) { if (!members.some(m => m.diary_id === d && m.user_id === me && m.role === "owner")) throw "Only the person who set up the diary can delete it"; Object.keys(entries).forEach(k => entries[k].diary_id === d && delete entries[k]); return null; }
  };
  const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/api/")) {
      let body = ""; req.on("data", c => body += c); req.on("end", () => {
        const op = ops[url.pathname.slice(5)], me = req.headers.authorization || null;
        try {
          if (!op) throw "Unknown";
          if (!["signUp", "signIn"].includes(url.pathname.slice(5)) && !users[me]) throw "Not signed in";
          const out = op(JSON.parse(body || "{}"), me);
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out === undefined ? null : out));
        } catch (e) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: String(e) })); }
      });
      return;
    }
    let p = join(distDir, url.pathname === "/" ? "index.html" : url.pathname);
    if (!existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }); res.end(readFileSync(p));
  });
  return new Promise(r => server.listen(port, () => r({ server, state: { users, members, entries } })));
}
