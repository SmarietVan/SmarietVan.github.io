/* ============================================================
   QQ空间博客后端 · Cloudflare Worker
   ------------------------------------------------------------
   职责：
   1. GitHub OAuth 登录（仅允许 OWNER 指定的账号）
   2. 登录成功后签发加密会话凭证（AES-GCM，stateless，无需 KV）
   3. 代理发文/删文：用用户自己的 GitHub token 提交到仓库

   环境变量（在 Worker 设置里配置）：
     GITHUB_CLIENT_ID      OAuth App 的 Client ID
     GITHUB_CLIENT_SECRET  OAuth App 的 Client Secret（用"加密"类型）
     SESSION_SECRET        随机长字符串，用于加密会话
     OWNER                 你的 GitHub 用户名，如 SmarietVan
     REPO                  仓库全名，如 SmarietVan/SmarietVan.github.io
     BRANCH                分支，如 main
     SITE                  站点地址，如 https://smarietvan.github.io

   路由：
     GET  /auth/login     跳转 GitHub 授权页
     GET  /auth/callback  OAuth 回调，签发会话，跳回站点
     GET  /api/me         查询当前登录状态（Header: Authorization: Bearer <session>）
     POST /api/save       发文/更新 { path, content, sha? }
     POST /api/delete     删文 { path, sha }
     POST /api/logout     仅前端清本地凭证即可，此路由仅返回 ok
   ============================================================ */

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---------- AES-GCM 会话加解密 ---------- */
async function keyFrom(secret) {
    const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function b64encode(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64decode(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function seal(obj, secret) {
    const key = await keyFrom(secret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
    return b64encode(iv) + "." + b64encode(data);
}

async function unseal(token, secret) {
    try {
        const [ivB, dataB] = token.split(".");
        const key = await keyFrom(secret);
        const plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: b64decode(ivB) }, key, b64decode(dataB));
        const obj = JSON.parse(dec.decode(plain));
        if (!obj.exp || Date.now() > obj.exp) return null; // 过期
        return obj;
    } catch {
        return null;
    }
}

/* ---------- 工具 ---------- */
function json(data, status = 200, origin = "*") {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
    });
}

function corsPreflight(origin) {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400",
        },
    });
}

async function gh(path, token, options = {}) {
    const resp = await fetch("https://api.github.com" + path, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "qzone-blog-worker",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
    });
    const body = await resp.json().catch(() => ({}));
    return { status: resp.status, body };
}

/* 校验会话：返回 { token, login } 或 null */
async function auth(req, env) {
    const h = req.headers.get("Authorization") || "";
    const session = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (!session) return null;
    const payload = await unseal(session, env.SESSION_SECRET);
    if (!payload || payload.login !== env.OWNER) return null;
    return payload;
}

/* ---------- 主入口 ---------- */
export default {
    async fetch(req, env) {
        const url = new URL(req.url);
        const origin = env.SITE || "*";

        if (req.method === "OPTIONS") return corsPreflight(origin);

        /* ---- 1. 发起登录 ---- */
        if (url.pathname === "/auth/login") {
            const state = crypto.randomUUID();
            const ghUrl = new URL("https://github.com/login/oauth/authorize");
            ghUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
            ghUrl.searchParams.set("redirect_uri", url.origin + "/auth/callback");
            ghUrl.searchParams.set("scope", "public_repo");
            ghUrl.searchParams.set("state", state);
            return new Response(null, {
                status: 302,
                headers: {
                    Location: ghUrl.toString(),
                    "Set-Cookie": `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
                },
            });
        }

        /* ---- 2. OAuth 回调 ---- */
        if (url.pathname === "/auth/callback") {
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            const cookie = req.headers.get("Cookie") || "";
            const cookieState = (cookie.match(/oauth_state=([^;]+)/) || [])[1];
            if (!code || !state || state !== cookieState) {
                return json({ error: "登录状态校验失败，请重试" }, 400, origin);
            }

            // code 换 token
            const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({
                    client_id: env.GITHUB_CLIENT_ID,
                    client_secret: env.GITHUB_CLIENT_SECRET,
                    code,
                }),
            }).then((r) => r.json());

            if (!tokenResp.access_token) {
                return json({ error: "GitHub 授权失败", detail: tokenResp }, 400, origin);
            }

            // 查登录者身份
            const me = await gh("/user", tokenResp.access_token);
            const login = me.body && me.body.login;
            if (login !== env.OWNER) {
                // 不是站长：跳回站点并提示
                return new Response(null, {
                    status: 302,
                    headers: { Location: `${env.SITE}/editor.html#denied=${encodeURIComponent(login || "unknown")}` },
                });
            }

            // 签发加密会话（7 天有效）
            const session = await seal({
                login,
                token: tokenResp.access_token,
                exp: Date.now() + 7 * 24 * 3600 * 1000,
            }, env.SESSION_SECRET);

            return new Response(null, {
                status: 302,
                headers: {
                    Location: `${env.SITE}/editor.html#session=${session}`,
                    "Set-Cookie": "oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
                },
            });
        }

        /* ---- 3. 查询登录状态 ---- */
        if (url.pathname === "/api/me") {
            const a = await auth(req, env);
            return json(a ? { loggedIn: true, login: a.login } : { loggedIn: false }, 200, origin);
        }

        /* ---- 4. 发文 / 更新 ---- */
        if (url.pathname === "/api/save" && req.method === "POST") {
            const a = await auth(req, env);
            if (!a) return json({ error: "未登录或会话已过期" }, 401, origin);

            const { path, content, message } = await req.json().catch(() => ({}));
            if (!path || !/^posts\/[\w.-]+\.md$/.test(path) || !content) {
                return json({ error: "参数不合法（仅允许 posts/*.md）" }, 400, origin);
            }

            // 已存在则需带 sha 更新
            const exist = await gh(`/repos/${env.REPO}/contents/${path}?ref=${env.BRANCH}`, a.token);
            const body = {
                message: message || `📝 ${exist.status === 200 ? "更新" : "发布"}日志 ${path}`,
                content: btoa(unescape(encodeURIComponent(content))),
                branch: env.BRANCH,
            };
            if (exist.status === 200) body.sha = exist.body.sha;

            const r = await gh(`/repos/${env.REPO}/contents/${path}`, a.token, {
                method: "PUT",
                body: JSON.stringify(body),
            });
            if (r.status === 200 || r.status === 201) {
                return json({ ok: true, path }, 200, origin);
            }
            return json({ error: "提交失败", detail: r.body }, r.status, origin);
        }

        /* ---- 5. 删文 ---- */
        if (url.pathname === "/api/delete" && req.method === "POST") {
            const a = await auth(req, env);
            if (!a) return json({ error: "未登录或会话已过期" }, 401, origin);

            const { path } = await req.json().catch(() => ({}));
            if (!path || !/^posts\/[\w.-]+\.md$/.test(path)) {
                return json({ error: "参数不合法（仅允许 posts/*.md）" }, 400, origin);
            }

            const exist = await gh(`/repos/${env.REPO}/contents/${path}?ref=${env.BRANCH}`, a.token);
            if (exist.status !== 200) return json({ error: "文件不存在" }, 404, origin);

            const r = await gh(`/repos/${env.REPO}/contents/${path}`, a.token, {
                method: "DELETE",
                body: JSON.stringify({
                    message: `🗑 删除日志 ${path}`,
                    sha: exist.body.sha,
                    branch: env.BRANCH,
                }),
            });
            return r.status === 200
                ? json({ ok: true }, 200, origin)
                : json({ error: "删除失败", detail: r.body }, r.status, origin);
        }

        return json({ error: "not found" }, 404, origin);
    },
};
