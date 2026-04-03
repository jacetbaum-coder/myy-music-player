// Reson API Worker — Multi-user music library backend
// Features: Magic link auth (Resend), per-user R2, song request queue, admin detection
// Bindings: MUSIC_BUCKET (R2), SESSIONS (KV), REQUESTS (KV), RESEND_API_KEY (env), OWNER_EMAIL (env)

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const errJson = (status, message, extra = {}) => json({ ok: false, error: message, ...extra }, status);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    // --- Utility ---
    const url = new URL(request.url);
    const getBody = async () => {
      try { return await request.json(); } catch { return {}; }
    };
    const hashEmail = async (email) => {
      const msgUint8 = new TextEncoder().encode(email.toLowerCase().trim());
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
    };
    const setCookie = (res, cookie) => {
      res.headers.append('Set-Cookie', cookie);
      return res;
    };
    const getCookie = (name) => {
      const cookie = request.headers.get('Cookie') || '';
      const m = cookie.match(new RegExp(`${name}=([^;]+)`));
      return m ? m[1] : null;
    };
    const makeSession = async (email) => {
      const userId = await hashEmail(email);
      const sessionId = crypto.randomUUID();
      const data = { email, userId, created: Date.now() };
      await env.SESSIONS.put(sessionId, JSON.stringify(data), { expirationTtl: 7 * 24 * 60 * 60 });
      return { sessionId, ...data };
    };
    const getSession = async () => {
      const sid = getCookie('session');
      if (!sid) return null;
      const raw = await env.SESSIONS.get(sid);
      if (!raw) return null;
      try { return { ...JSON.parse(raw), sessionId: sid }; } catch { return null; }
    };
    const isAdmin = (email) => email && env.OWNER_EMAIL && email.toLowerCase() === env.OWNER_EMAIL.toLowerCase();

    // --- 1. Magic link auth ---
    if (url.pathname === '/auth/magic-link' && request.method === 'POST') {
      const { email } = await getBody();
      if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) return errJson(400, 'Invalid email');
      const token = crypto.randomUUID();
      await env.SESSIONS.put(`magic:${token}`, email, { expirationTtl: 900 });
      // TODO: Set this to your app's URL
      const verifyUrl = `https://resonmusic.us/?token=${token}`;
      // Send email via Resend
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `noreply@resonmusic.us`,
          to: email,
          subject: 'Sign in to Reson',
          html: `<p>Click to sign in: <a href="${verifyUrl}">${verifyUrl}</a></p>`
        })
      });
      if (!r.ok) return errJson(500, 'Failed to send email');
      return json({ ok: true });
    }
    if (url.pathname === '/auth/verify' && request.method === 'GET') {
      const token = url.searchParams.get('token');
      if (!token) return errJson(400, 'Missing token');
      const email = await env.SESSIONS.get(`magic:${token}`);
      if (!email) return errJson(400, 'Invalid or expired token');
      const { sessionId } = await makeSession(email);
      // Set cookie and redirect to app
      const res = new Response(null, { status: 302, headers: { 'Location': 'https://resonmusic.us/' } });
      res.headers.append('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
      return res;
    }
    if (url.pathname === '/auth/me' && request.method === 'GET') {
      const session = await getSession();
      if (!session) return json({ ok: false });
      return json({ ok: true, email: session.email, userId: session.userId, isAdmin: isAdmin(session.email) });
    }
    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      const session = await getSession();
      if (session) await env.SESSIONS.delete(session.sessionId);
      const res = json({ ok: true });
      res.headers.append('Set-Cookie', 'session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
      return res;
    }

    // --- 2. Per-user library API ---
    if (url.pathname === '/user/songs' && request.method === 'GET') {
      const session = await getSession();
      if (!session) return errJson(401, 'Not signed in');
      const prefix = `users/${session.userId}/`;
      const page = await env.MUSIC_BUCKET.list({ prefix, limit: 1000 });
      const keys = (page.objects || []).map(o => o.key);
      // Group by Artist/Album
      const albums = {};
      for (const key of keys) {
        const parts = key.replace(prefix, '').split('/');
        if (parts.length < 3) continue;
        const [artist, album, file] = parts;
        const albumKey = `${artist}///${album}`;
        if (!albums[albumKey]) albums[albumKey] = { artistName: artist, albumName: album, songs: [] };
        albums[albumKey].songs.push({
          id: key, r2Path: key, fileName: file, title: file.replace(/\.[^/.]+$/, ''), artistName: artist, albumName: album,
          link: `${url.origin}/?id=${encodeURIComponent(key)}`
        });
      }
      return json(Object.values(albums));
    }
    // TODO: POST /user/upload (multipart upload to R2)
    // TODO: DELETE /user/song (delete from R2)

    // --- 3. Song request queue ---
    if (url.pathname === '/requests' && request.method === 'POST') {
      const session = await getSession();
      if (!session) return errJson(401, 'Not signed in');
      const { text } = await getBody();
      if (!text || text.length < 2) return errJson(400, 'Missing request text');
      const id = crypto.randomUUID();
      const req = { id, email: session.email, userId: session.userId, text, status: 'pending', createdAt: Date.now() };
      await env.REQUESTS.put(id, JSON.stringify(req));
      return json({ ok: true, id });
    }
    if (url.pathname === '/requests' && request.method === 'GET') {
      const session = await getSession();
      if (!session || !isAdmin(session.email)) return errJson(401, 'Admin only');
      const list = await env.REQUESTS.list({ limit: 100 });
      const items = [];
      for (const k of list.keys) {
        const raw = await env.REQUESTS.get(k.name);
        if (raw) items.push(JSON.parse(raw));
      }
      return json({ ok: true, items });
    }
    if (url.pathname.startsWith('/requests/') && request.method === 'PATCH') {
      const session = await getSession();
      if (!session || !isAdmin(session.email)) return errJson(401, 'Admin only');
      const id = url.pathname.split('/').pop();
      const req = await env.REQUESTS.get(id);
      if (!req) return errJson(404, 'Not found');
      const { status } = await getBody();
      const updated = { ...JSON.parse(req), status: status || 'pending', updatedAt: Date.now() };
      await env.REQUESTS.put(id, JSON.stringify(updated));
      return json({ ok: true });
    }
    if (url.pathname.startsWith('/requests/') && request.method === 'POST') {
      // /requests/{id}/notify — send email to requester
      const session = await getSession();
      if (!session || !isAdmin(session.email)) return errJson(401, 'Admin only');
      const id = url.pathname.split('/')[2];
      const req = await env.REQUESTS.get(id);
      if (!req) return errJson(404, 'Not found');
      const { email, text, status } = JSON.parse(req);
      // Send email via Resend
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `noreply@resonmusic.us`,
          to: email,
          subject: `Your song request: ${text}`,
          html: `<p>Your request <b>${text}</b> is now <b>${status}</b>.</p>`
        })
      });
      if (!r.ok) return errJson(500, 'Failed to send email');
      return json({ ok: true });
    }

    // --- Default: Not found ---
    return errJson(404, 'Not found');
  }
};