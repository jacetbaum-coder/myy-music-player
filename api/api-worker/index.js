// Reson API Worker — Multi-user music library backend
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

    const url = new URL(request.url);
    const getBody = async () => { try { return await request.json(); } catch { return {}; } };

    const hashEmail = async (email) => {
      const msgUint8 = new TextEncoder().encode(email.toLowerCase().trim());
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
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

    // --- Password-based registration ---
    if (url.pathname === '/auth/register' && request.method === 'POST') {
      const { email, password } = await getBody();
      if (!email || !password || password.length < 6) return errJson(400, 'Email and password (min 6 chars) required');
      const userId = await hashEmail(email);
      const userKey = `user:${userId}`;
      const existing = await env.SESSIONS.get(userKey);
      if (existing) return errJson(400, 'User already exists');
      const pwHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)))).map(b => b.toString(16).padStart(2, '0')).join('');
      await env.SESSIONS.put(userKey, JSON.stringify({ email, pwHash }), { expirationTtl: 365*24*60*60 });
      return json({ ok: true });
    }

    // --- Password-based login ---
    if (url.pathname === '/auth/login' && request.method === 'POST') {
      const { email, password } = await getBody();
      if (!email || !password) return errJson(400, 'Email and password required');
      const userId = await hashEmail(email);
      const userKey = `user:${userId}`;
      const userRaw = await env.SESSIONS.get(userKey);
      if (!userRaw) return errJson(400, 'User not found');
      const user = JSON.parse(userRaw);
      const pwHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)))).map(b => b.toString(16).padStart(2, '0')).join('');
      if (user.pwHash !== pwHash) return errJson(401, 'Incorrect password');
      const { sessionId } = await makeSession(email);
      const res = json({ ok: true });
      res.headers.append('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
      return res;
    }

    // --- Magic link auth ---
    if (url.pathname === '/auth/magic-link' && request.method === 'POST') {
      try {
        const { email } = await getBody();
        if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) return errJson(400, 'Invalid email');
        const token = crypto.randomUUID();
        await env.SESSIONS.put(`magic:${token}`, email, { expirationTtl: 900 });
        const verifyUrl = `https://resonmusic.us/auth/verify?token=${token}`;
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'auth@resonmusic.us',
            to: email,
            subject: 'Sign in to Reson',
            html: `<p>Click to sign in: <a href="${verifyUrl}">${verifyUrl}</a></p>`
          })
        });
        if (!r.ok) {
          const details = await r.text();
          return errJson(500, 'Failed to send email', { details });
        }
        return json({ ok: true });
      } catch (err) {
        return errJson(500, 'Failed to send email', { details: err.message });
      }
    }

    if (url.pathname === '/auth/verify' && request.method === 'GET') {
      const token = url.searchParams.get('token');
      if (!token) return errJson(400, 'Missing token');
      const email = await env.SESSIONS.get(`magic:${token}`);
      if (!email) return errJson(400, 'Invalid or expired token');
      const { sessionId } = await makeSession(email);
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

    // --- Per-user library API ---
    if (url.pathname === '/user/songs' && request.method === 'GET') {
      const session = await getSession();
      if (!session) return errJson(401, 'Not signed in');
      const prefix = `users/${session.userId}/`;
      const page = await env.MUSIC_BUCKET.list({ prefix, limit: 1000 });
      const keys = (page.objects || []).map(o => o.key);
      const albums = {};
      for (const key of keys) {
        const parts = key.replace(prefix, '').split('/');
        if (parts.length < 3) continue;
        const [artist, album, file] = parts;
        // Guard: skip if the prefix wasn't stripped (artist would be 'users' or the userId hash)
        if (artist === 'users' || /^[0-9a-f]{8,}$/i.test(artist)) continue;
        if (file === 'cover.jpg') continue; // skip cover art objects from song list
        const albumKey = `${artist}///${album}`;
        if (!albums[albumKey]) {
          albums[albumKey] = {
            artistName: artist,
            albumName: album,
            coverArt: `https://music-streamer.jacetbaum.workers.dev/?id=${encodeURIComponent(prefix + artist + '/' + album + '/cover.jpg')}`,
            songs: [],
          };
        }
        albums[albumKey].songs.push({
          id: key,
          r2Path: key,
          fileName: file,
          title: file.replace(/\.[^/.]+$/, ''),
          artistName: artist,
          albumName: album,
          link: `https://music-streamer.jacetbaum.workers.dev/?id=${encodeURIComponent(key)}`
        });
      }
      return json(Object.values(albums));
    }

    // --- Song request queue ---
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
      const session = await getSession();
      if (!session || !isAdmin(session.email)) return errJson(401, 'Admin only');
      const id = url.pathname.split('/')[2];
      const req = await env.REQUESTS.get(id);
      if (!req) return errJson(404, 'Not found');
      const { email, text, status } = JSON.parse(req);
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'auth@resonmusic.us',
          to: email,
          subject: `Your request has been updated`,
          html: `<p>Your request "${text}" is now "${status}"</p>`
        })
      });
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Route not found' }, 404);
  }
};