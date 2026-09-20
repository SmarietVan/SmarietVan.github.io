/* ============================================================
   页面逻辑路由：根据 <body data-page="..."> 分发
   依赖：store.js（Store）、qqzone.js（GISCUS_CONFIG）
   ============================================================ */

/* ---------- 站点配置 ---------- */
const SITE_CONFIG = {
    repoOwner: "SmarietVan",
    repoName: "SmarietVan.github.io",
    branch: "main",
    commentsRepo: "guestbook-comments",  // 评论以 issue 形式存这里
    approvedLabel: "已通过",              // 打上此 label 的评论才公开展示
};

/* ---------- 通用工具 ---------- */
function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

function fmtTime(t) {
    // "2025-01-01 12:00" → "2025年1月1日 12:00"
    const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(t || "");
    if (!m) return t;
    return `${+m[1]}年${+m[2]}月${+m[3]}日${m[4]}`;
}

function toast(msg) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
}

/* 通用模态框：modal(title, bodyHTML) → { mask, close } */
function modal(title, bodyHTML) {
    const mask = document.createElement("div");
    mask.className = "modal-mask";
    mask.innerHTML = `
        <div class="modal">
            <div class="modal-head">${esc(title)}<button class="modal-close">✕</button></div>
            <div class="modal-body"></div>
        </div>`;
    mask.querySelector(".modal-body").innerHTML = bodyHTML;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    mask.querySelector(".modal-close").addEventListener("click", close);
    mask.addEventListener("click", (e) => { if (e.target === mask) close(); });
    return { mask, close };
}

function getQuery(key) {
    return new URLSearchParams(location.search).get(key);
}

/* 点赞状态（本地记忆） */
const Liked = {
    get ids() {
        try { return JSON.parse(localStorage.getItem("qqzone-liked") || "[]"); }
        catch { return []; }
    },
    has(id) { return this.ids.includes(id); },
    toggle(id) {
        const ids = this.ids;
        const i = ids.indexOf(id);
        if (i >= 0) ids.splice(i, 1); else ids.push(id);
        localStorage.setItem("qqzone-liked", JSON.stringify(ids));
        return i < 0; // true = 现在已赞
    },
};

const COMMENT_AVATARS = ["🐱", "🐶", "🦊", "🐼", "🐸", "🦁", "🐰", "🐨"];
function avatarOf(name) {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) >>> 0;
    return COMMENT_AVATARS[h % COMMENT_AVATARS.length];
}

/* ============================================================
   站长登录（GitHub Personal Access Token，仅存站长本机浏览器）
   token 只需 Contents 读写权限、仅限本仓库；访客永远接触不到
   ============================================================ */
const Session = {
    KEY: "qqzone-gh-token",
    token: null,
    login: null,

    init() {
        this.token = localStorage.getItem(this.KEY);
    },

    get ready() { return !!this.token; },

    /* 校验 token 有效且是站长本人 */
    async check() {
        if (!this.token) return false;
        try {
            const r = await fetch("https://api.github.com/user", {
                headers: { Authorization: "Bearer " + this.token, Accept: "application/vnd.github+json" },
            });
            if (!r.ok) throw 0;
            const me = await r.json();
            if (me.login !== SITE_CONFIG.repoOwner) {
                toast(`该 token 属于 ${me.login}，不是站长账号`);
                this.logout();
                return false;
            }
            this.login = me.login;
            return true;
        } catch {
            this.token = null;
            localStorage.removeItem(this.KEY);
            return false;
        }
    },

    /* 登录弹窗：粘贴 PAT */
    login() {
        const { mask, close } = modal("站长登录（GitHub Token）", `
            <ol style="font-size:13px;color:var(--card-dim);line-height:2;padding-left:18px">
                <li>打开 <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener">GitHub 新建 token（classic）</a></li>
                <li>Note 随便填，Expiration 建议 90 天</li>
                <li>勾选 <b>public_repo</b> 这一个权限就够了</li>
                <li>生成后把 token 粘贴到下面</li>
            </ol>
            <input type="password" id="patInput" placeholder="ghp_..." autocomplete="off">
            <div class="modal-actions" style="padding:14px 0 0;border:none">
                <button class="btn-blue" id="patOk">验证并登录</button>
            </div>
            <p style="font-size:12px;color:var(--card-dim);margin-top:10px">token 只保存在你自己的浏览器里，用于调用 GitHub API 发文和审核评论，不会上传到任何第三方。</p>`);
        mask.querySelector("#patOk").addEventListener("click", async () => {
            const v = mask.querySelector("#patInput").value.trim();
            if (!v) { toast("请先粘贴 token"); return; }
            Session.token = v;
            const ok = await Session.check();
            if (ok) {
                localStorage.setItem(Session.KEY, v);
                close();
                toast("登录成功，欢迎站长回家！");
                setTimeout(() => location.reload(), 800);
            } else if (Session.token) {
                toast("token 无效或已过期");
                Session.token = null;
            }
        });
    },

    logout() {
        this.token = null;
        this.login = null;
        localStorage.removeItem(this.KEY);
        toast("已退出登录");
    },

    /* ---- 直接调 GitHub Contents API 发文/删文 ---- */
    _headers() {
        return {
            Authorization: "Bearer " + this.token,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
        };
    },
    _api(path) {
        return `https://api.github.com/repos/${SITE_CONFIG.repoOwner}/${SITE_CONFIG.repoName}/contents/${path}`;
    },

    async savePost(path, content) {
        try {
            const exist = await fetch(this._api(path) + "?ref=" + SITE_CONFIG.branch, { headers: this._headers() });
            const body = {
                message: `${exist.ok ? "更新" : "发布"}日志 ${path}`,
                content: btoa(unescape(encodeURIComponent(content))),
                branch: SITE_CONFIG.branch,
            };
            if (exist.ok) body.sha = (await exist.json()).sha;
            const r = await fetch(this._api(path), { method: "PUT", headers: this._headers(), body: JSON.stringify(body) });
            return r.ok ? { ok: true } : { error: (await r.json()).message || ("HTTP " + r.status) };
        } catch (e) {
            return { error: "网络异常：" + e.message };
        }
    },

    /* 删除仓库文件（Contents API） */
    async deleteFile(path, message) {
        try {
            const exist = await fetch(this._api(path) + "?ref=" + SITE_CONFIG.branch, { headers: this._headers() });
            if (!exist.ok) return { error: "文件不存在" };
            const sha = (await exist.json()).sha;
            const r = await fetch(this._api(path), {
                method: "DELETE",
                headers: this._headers(),
                body: JSON.stringify({ message: message || `删除 ${path}`, sha, branch: SITE_CONFIG.branch }),
            });
            return r.ok ? { ok: true } : { error: (await r.json()).message || ("HTTP " + r.status) };
        } catch (e) {
            return { error: "网络异常：" + e.message };
        }
    },

    async deletePost(path) {
        try {
            const exist = await fetch(this._api(path) + "?ref=" + SITE_CONFIG.branch, { headers: this._headers() });
            if (!exist.ok) return { error: "文件不存在" };
            const sha = (await exist.json()).sha;
            const r = await fetch(this._api(path), {
                method: "DELETE",
                headers: this._headers(),
                body: JSON.stringify({ message: `删除日志 ${path}`, sha, branch: SITE_CONFIG.branch }),
            });
            return r.ok ? { ok: true } : { error: (await r.json()).message || ("HTTP " + r.status) };
        } catch (e) {
            return { error: "网络异常：" + e.message };
        }
    },

    /* 上传二进制文件（如音乐）：Contents API 限 1MB，走 Git Data API 支持大文件 */
    async uploadBinary(path, file, message) {
        const dataUrl = await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = rej;
            fr.readAsDataURL(file);
        });
        return this.commitFiles([{ path, base64: dataUrl.split(",")[1] }], message || `上传文件 ${path}`);
    },

    /* 单 commit 提交多个文件：files = [{ path, base64 }] 或 [{ path, text }]
       onProgress(stage, i, total)：blob=逐个上传中，tree/commit/ref=收尾阶段 */
    async commitFiles(files, message, onProgress) {
        const git = `https://api.github.com/repos/${SITE_CONFIG.repoOwner}/${SITE_CONFIG.repoName}/git`;
        const headers = this._headers();
        const report = (s, i, t) => { if (onProgress) onProgress(s, i, t); };
        try {
            // 1. 每个文件建 blob
            const treeItems = [];
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                report("blob", i + 1, files.length);
                const base64 = f.base64 ?? btoa(unescape(encodeURIComponent(f.text)));
                const blob = await fetch(`${git}/blobs`, {
                    method: "POST", headers,
                    body: JSON.stringify({ content: base64, encoding: "base64" }),
                }).then((r) => r.json());
                if (!blob.sha) return { error: blob.message || "创建 blob 失败", stage: "blob", index: i };
                treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
            }

            // 2. 当前分支 head → base tree
            report("tree", 0, 0);
            const ref = await fetch(`${git}/ref/heads/${SITE_CONFIG.branch}`, { headers }).then((r) => r.json());
            const headSha = ref.object && ref.object.sha;
            if (!headSha) return { error: "读取分支失败", stage: "tree" };
            const headCommit = await fetch(`${git}/commits/${headSha}`, { headers }).then((r) => r.json());

            // 3. 新 tree → 新 commit → 更新 ref
            const tree = await fetch(`${git}/trees`, {
                method: "POST", headers,
                body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: treeItems }),
            }).then((r) => r.json());
            if (!tree.sha) return { error: tree.message || "创建 tree 失败", stage: "tree" };

            report("commit", 0, 0);
            const commit = await fetch(`${git}/commits`, {
                method: "POST", headers,
                body: JSON.stringify({ message: message || "更新", tree: tree.sha, parents: [headSha] }),
            }).then((r) => r.json());
            if (!commit.sha) return { error: commit.message || "创建 commit 失败", stage: "commit" };

            report("ref", 0, 0);
            const upd = await fetch(`${git}/refs/heads/${SITE_CONFIG.branch}`, {
                method: "PATCH", headers,
                body: JSON.stringify({ sha: commit.sha }),
            });
            return upd.ok ? { ok: true } : { error: "更新分支失败", stage: "ref" };
        } catch (e) {
            return { error: "网络异常：" + e.message, stage: "network" };
        }
    },
};

/* 读取仓库 JSON 文件（同源加载 + 防缓存；本地/线上通用） */
async function fetchRepoJson(path) {
    const r = await fetch(path + "?t=" + Date.now());
    return r.ok ? r.json() : null;
}

/* Markdown 渲染（marked 加载失败时自动重试，最终兜底纯文本） */
function renderMd(el, md) {
    if (typeof marked !== "undefined") {
        el.innerHTML = marked.parse(md, { breaks: true });
        return;
    }
    if (renderMd._loading) { renderMd._queue.push([el, md]); return; }
    renderMd._loading = true;
    renderMd._queue = [[el, md]];
    const s = document.createElement("script");
    s.src = "assets/js/marked.min.js";
    s.onload = () => {
        renderMd._queue.forEach(([e, m]) => { e.innerHTML = marked.parse(m, { breaks: true }); });
        renderMd._loading = false;
        renderMd._queue = [];
    };
    s.onerror = () => {
        renderMd._queue.forEach(([e, m]) => { e.textContent = m; });
        renderMd._loading = false;
        renderMd._queue = [];
    };
    document.body.appendChild(s);
}
renderMd._loading = false;
renderMd._queue = [];

/* ============================================================
   音乐播放器（全局）：播放列表存仓库 data/music.json
   [{ name, path }] —— 所有访客可见可听
   ============================================================ */
const Player = {
    tracks: [],
    idx: -1,
    audio: null,

    async init() {
        this.audio = document.getElementById("bgm");
        if (!this.audio) return;
        let manifest = null;
        try {
            const m = await fetchRepoJson("data/music.json");
            if (Array.isArray(m)) manifest = m;
        } catch { /* 清单拉不到 */ }
        if (manifest) this.tracks = manifest;
        else this.tracks = [{ name: "背景音乐", path: "assets/music/bgm.mp3" }]; // 旧版单文件兼容
        this.bindMini();
        this.restoreState();
    },

    /* 播放状态持久化：切页/刷新/冷启动都续上 */
    saveState() {
        if (this.idx < 0) return;
        localStorage.setItem("qqzone-player", JSON.stringify({
            idx: this.idx,
            time: this.audio.currentTime || 0,
            playing: !this.audio.paused,
        }));
    },

    restoreState() {
        let s = null;
        try { s = JSON.parse(localStorage.getItem("qqzone-player")); } catch { /* 无 */ }
        if (!s || s.idx < 0 || s.idx >= this.tracks.length) return;
        this.idx = s.idx;
        this.audio.src = this.tracks[s.idx].path;
        this.updateName();
        this.audio.addEventListener("loadedmetadata", () => {
            if (s.time) this.audio.currentTime = s.time;
        }, { once: true });
        if (s.playing) {
            this.audio.play().catch(() => {
                // 浏览器禁止自动播放：呼吸灯提示，页面任意处点一下即续播
                const btn = document.getElementById("playBtn");
                if (btn) btn.classList.add("pulse");
                document.addEventListener("click", () => {
                    this.audio.play().catch(() => {});
                    if (btn) btn.classList.remove("pulse");
                }, { once: true });
            });
        }
    },

    bindMini() {
        const btn = document.getElementById("playBtn");
        const nameEl = document.getElementById("musicName");
        const box = document.getElementById("musicPlayer");
        if (!btn || !nameEl) return;

        nameEl.textContent = this.tracks.length ? this.tracks[0].name : "暂无音乐";

        btn.addEventListener("click", () => this.toggle());
        nameEl.style.cursor = "pointer";
        nameEl.title = "打开音乐盒";
        nameEl.addEventListener("click", () => (location.href = "music.html"));

        this.audio.addEventListener("play", () => { box.classList.add("playing"); btn.textContent = "⏸"; btn.classList.remove("pulse"); this.saveState(); });
        this.audio.addEventListener("pause", () => { box.classList.remove("playing"); btn.textContent = "▶"; this.saveState(); });
        this.audio.addEventListener("ended", () => this.next());
        this.audio.addEventListener("waiting", () => { nameEl.textContent = "缓冲中…"; });
        this.audio.addEventListener("playing", () => this.updateName());
        this.audio.addEventListener("timeupdate", () => {
            if (!this._lastSave || Date.now() - this._lastSave > 2000) {
                this._lastSave = Date.now();
                this.saveState();
            }
        });
        this.audio.addEventListener("error", () => {
            box.classList.remove("playing");
            nameEl.textContent = "暂无音乐，去音乐盒上传";
        });
    },

    updateName() {
        const nameEl = document.getElementById("musicName");
        if (nameEl && this.idx >= 0) nameEl.textContent = this.tracks[this.idx].name;
    },

    playAt(i) {
        if (!this.tracks.length) return;
        this.idx = ((i % this.tracks.length) + this.tracks.length) % this.tracks.length;
        this.audio.src = this.tracks[this.idx].path;
        this.updateName();
        this.audio.play().catch(() => toast("播放失败，文件可能还在部署中"));
        document.dispatchEvent(new CustomEvent("player:change"));
    },

    toggle() {
        if (this.audio.paused) {
            if (this.idx < 0) this.playAt(0);
            else this.audio.play().catch(() => toast("播放失败"));
        } else {
            this.audio.pause();
        }
    },

    next() { this.playAt(this.idx + 1); },
    prev() { this.playAt(this.idx - 1); },
};

/* ============================================================
   站点配置（所有人可见）：仓库 data/site.json
   ============================================================ */
const SiteCfg = {
    data: null,

    async load() {
        try {
            const c = await fetchRepoJson("data/site.json");
            if (c && typeof c === "object") this.data = c;
        } catch { /* 无配置 */ }
        this.apply();
    },

    nick() { return (this.data && this.data.ownerNick) || "SmarietVan"; },

    apply() {
        const c = this.data;
        if (!c) return;

        if (c.spaceName) {
            document.querySelectorAll(".space-name").forEach((el) => {
                for (const n of el.childNodes) {
                    if (n.nodeType === 3) { n.textContent = c.spaceName + " "; break; }
                }
            });
            document.querySelectorAll(".logo").forEach((el) => {
                el.innerHTML = `<span class="logo-star">★</span> ${esc(c.spaceName)}`;
            });
            document.title = document.title.replace("SmarietVan的空间", c.spaceName);
        }
        if (c.ownerNick) {
            document.querySelectorAll(".owner-nick, .topbar-nick, .post-name").forEach((el) => {
                el.textContent = c.ownerNick;
            });
        }
        if (c.profile && Array.isArray(c.profile)) {
            const list = document.querySelector(".info-list");
            if (list) {
                list.innerHTML = c.profile.map((line) => {
                    const i = line.indexOf("|");
                    const icon = i > 0 ? line.slice(0, i) : "📌";
                    const text = i > 0 ? line.slice(i + 1) : line;
                    return `<li><span class="info-icon">${esc(icon)}</span> ${esc(text)}</li>`;
                }).join("");
            }
        }
        /* 顶部横幅背景 */
        const banner = document.querySelector(".banner");
        if (banner && c.banner) {
            if (c.banner.mode === "color" && c.banner.color) {
                banner.style.background = c.banner.color;
            } else if (c.banner.mode === "image" && c.banner.image) {
                banner.style.background = `url("${c.banner.image}") center/cover no-repeat`;
            }
        }
        /* 页面背景 */
        if (c.pageBg) {
            if (c.pageBg.mode === "color" && c.pageBg.color) {
                document.body.style.background = c.pageBg.color;
            } else if (c.pageBg.mode === "image" && c.pageBg.image) {
                document.body.style.background = `url("${c.pageBg.image}") center/cover fixed no-repeat`;
            }
        }
    },
};

/* ============================================================
   GitHub 评论体系
   评论 = guestbook-comments 仓库的 issue（作者即 GitHub 用户名）
   审核 = label「已通过」：没有该 label 的公开页面不展示
   ============================================================ */
const GhComments = {
    apiBase() {
        return `https://api.github.com/repos/${SITE_CONFIG.repoOwner}/${SITE_CONFIG.commentsRepo}`;
    },

    /* 某篇日志下已通过的评论（公开，无需登录） */
    async approved(postId) {
        const r = await fetch(`${this.apiBase()}/issues?state=open&labels=${encodeURIComponent(SITE_CONFIG.approvedLabel)}&per_page=100`);
        if (!r.ok) return [];
        const issues = await r.json();
        return issues
            .filter((i) => i.title.startsWith(`[${postId}]`))
            .map((i) => ({
                n: i.number,
                author: i.user.login,
                avatar: i.user.avatar_url,
                url: i.user.html_url,
                text: i.body || "",
                time: i.created_at.slice(0, 16).replace("T", " "),
            }))
            .sort((a, b) => a.time.localeCompare(b.time));
    },

    /* 待审核 = open 且没有「已通过」label（站长用） */
    async pending() {
        const r = await fetch(`${this.apiBase()}/issues?state=open&per_page=100`, {
            headers: Session._headers(),
        });
        if (!r.ok) return null;
        const issues = await r.json();
        return issues.filter((i) => !i.labels.some((l) => l.name === SITE_CONFIG.approvedLabel));
    },

    /* 已通过列表（站长用） */
    async approvedAll() {
        const r = await fetch(`${this.apiBase()}/issues?state=open&labels=${encodeURIComponent(SITE_CONFIG.approvedLabel)}&per_page=100`, {
            headers: Session._headers(),
        });
        if (!r.ok) return null;
        return r.json();
    },

    async approve(n) {
        const r = await fetch(`${this.apiBase()}/issues/${n}/labels`, {
            method: "POST",
            headers: Session._headers(),
            body: JSON.stringify({ labels: [SITE_CONFIG.approvedLabel] }),
        });
        return r.ok;
    },

    async revoke(n) {
        const r = await fetch(`${this.apiBase()}/issues/${n}/labels/${encodeURIComponent(SITE_CONFIG.approvedLabel)}`, {
            method: "DELETE",
            headers: Session._headers(),
        });
        return r.ok;
    },

    async reject(n) {
        const r = await fetch(`${this.apiBase()}/issues/${n}`, {
            method: "PATCH",
            headers: Session._headers(),
            body: JSON.stringify({ state: "closed" }),
        });
        return r.ok;
    },

    /* 访客写评论：跳 GitHub 新建 issue（未登录会先引导登录） */
    commentUrl(postId, postTitle) {
        const t = encodeURIComponent(`[${postId}] ${postTitle.slice(0, 20)}`);
        const b = encodeURIComponent("在这里写下你的评论……\n\n（提交后需站长审核通过才会展示）");
        return `https://github.com/${SITE_CONFIG.repoOwner}/${SITE_CONFIG.commentsRepo}/issues/new?title=${t}&body=${b}`;
    },
};

/* ============================================================
   仓库日志加载器（posts/*.md）
   本地预览：读 posts/index.json + 相对路径
   线上：GitHub API 列目录 + raw.githubusercontent 读内容
   ============================================================ */
const RepoPosts = {
    list: null,

    parseMd(filename, text) {
        const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
        const fm = {};
        if (m) {
            m[1].split(/\r?\n/).forEach((line) => {
                const i = line.indexOf(":");
                if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
            });
        }
        return {
            id: filename.replace(/\.md$/, ""),
            repo: true,
            title: fm.title || filename,
            cate: fm.cate || "个人日记",
            time: fm.time || "",
            content: (m ? m[2] : text).trim(),
        };
    },

    buildMd({ title, cate, time, content }) {
        return `---\ntitle: ${title}\ncate: ${cate}\ntime: ${time}\n---\n${content}\n`;
    },

    async load(force) {
        if (this.list && !force) return this.list;
        try {
            const files = (await fetch("posts/index.json?t=" + Date.now()).then((r) => (r.ok ? r.json() : [])))
                .filter((n) => n.endsWith(".md"));
            const results = await Promise.all(files.map(async (f) => {
                const text = await fetch("posts/" + f).then((r) => (r.ok ? r.text() : null));
                if (text === null || !text.trim()) return null; // 索引里的幽灵条目：文件已不存在
                return this.parseMd(f, text);
            }));
            this.list = results.filter(Boolean);
        } catch {
            this.list = [];
        }
        return this.list;
    },

    async getById(id) {
        const list = await this.load();
        return list.find((p) => p.id === id) || null;
    },
};

/* 更新日志索引 posts/index.json（同源加载依赖它列目录） */
async function updatePostsIndex({ add, remove } = {}) {
    let idx = [];
    try { idx = await fetch("posts/index.json?t=" + Date.now()).then((r) => (r.ok ? r.json() : [])); } catch { /* 视为空 */ }
    if (remove) idx = idx.filter((f) => f !== remove + ".md");
    if (add && !idx.includes(add + ".md")) idx.push(add + ".md");
    return Session.commitFiles([{ path: "posts/index.json", text: JSON.stringify(idx) }], "📝 更新日志索引");
}

/* 任意日志（仓库/本地）统一取 meta */
function metaOf(id) { return Store.getMeta(id); }

/* ============================================================
   主页：动态流
   ============================================================ */
async function pageHome() {
    const d = Store.data;
    document.getElementById("statAlbums").textContent = d.albums.filter((a) => !a.deleted).length;
    document.getElementById("statMsgs").textContent = d.msgs.length;

    const feed = document.getElementById("feed");
    feed.innerHTML = `<section class="card"><div class="feed-empty">正在读取日志……</div></section>`;

    const posts = (await RepoPosts.load()).sort((a, b) => b.time.localeCompare(a.time));
    document.getElementById("statPosts").textContent = posts.length;

    if (!posts.length) {
        feed.innerHTML = `<section class="card"><div class="feed-empty">还没有动态，去 <a href="editor.html">写一篇日志</a> 吧～</div></section>`;
        return;
    }

    feed.innerHTML = posts.map((p) => {
        const meta = metaOf(p.id);
        const liked = Liked.has(p.id);
        const excerpt = esc(p.content.slice(0, 140)) + (p.content.length > 140 ? "……" : "");
        return `
        <article class="card post" data-id="${esc(p.id)}">
            <header class="post-head">
                <img class="post-avatar" src="https://github.com/SmarietVan.png" alt="">
                <div class="post-meta">
                    <div class="post-name">SmarietVan</div>
                    <div class="post-time">${esc(fmtTime(p.time))}</div>
                </div>
            </header>
            <div class="post-content">
                <a class="post-title-link" href="post.html?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a><br>
                ${excerpt}${p.content.length > 140 ? ` <a href="post.html?id=${encodeURIComponent(p.id)}">全文»</a>` : ""}
            </div>
            <div class="post-source">📱 来自 GitHub Pages · 分类：${esc(p.cate)}</div>
            <div class="post-foot">
                <span class="views">💬 评论需审核后显示</span>
                <span class="actions">
                    <button class="act like-btn ${liked ? "liked" : ""}">👍 <i>${meta.likes}</i></button>
                    <a class="act" href="post.html?id=${encodeURIComponent(p.id)}#comments" title="评论">💬</a>
                    <button class="act share-btn" title="分享">↗</button>
                </span>
            </div>
            <div class="like-list ${liked ? "" : "hidden"}">👍 <b>你</b> 觉得很赞</div>
            <a class="comment-box comment-entry" href="post.html?id=${encodeURIComponent(p.id)}#comments">💬 来评论区坐坐（GitHub 账号评论）</a>
        </article>`;
    }).join("");

    feed.querySelectorAll(".post").forEach((el) => {
        const id = el.dataset.id;
        const meta = metaOf(id);

        el.querySelector(".like-btn").addEventListener("click", (e) => {
            const btn = e.currentTarget;
            const liked = Liked.toggle(id);
            meta.likes += liked ? 1 : -1;
            Store.saveMeta();
            btn.classList.toggle("liked", liked);
            btn.querySelector("i").textContent = meta.likes;
            el.querySelector(".like-list").classList.toggle("hidden", !liked);
        });

        el.querySelector(".share-btn").addEventListener("click", () => {
            const url = location.origin + location.pathname.replace(/[^/]*$/, "") + "post.html?id=" + encodeURIComponent(id);
            (navigator.clipboard?.writeText(url) || Promise.reject())
                .then(() => toast("链接已复制，快去分享吧"))
                .catch(() => toast("分享链接：" + url));
        });
    });
}

/* ============================================================
   日志列表页
   ============================================================ */
async function pageBlog() {
    let tab = "public";      // public | private
    let cateFilter = null;
    let monthFilter = null;  // "2025-01"
    let year = new Date().getFullYear();

    const listEl = document.getElementById("blogList");
    const cateEl = document.getElementById("cateList");
    const loggedIn = await Session.check();
    const repoPosts = await RepoPosts.load();

    function localPosts() {
        return Store.data.posts.filter((p) => !p.deleted && !p.draft && p.priv);
    }

    function visible(p) {
        if (cateFilter && p.cate !== cateFilter) return false;
        if (monthFilter && !p.time.startsWith(monthFilter)) return false;
        return true;
    }

    function renderList() {
        let posts, isRepo;
        if (tab === "private") {
            posts = localPosts();
            isRepo = false;
        } else {
            posts = repoPosts;
            isRepo = true;
        }
        posts = posts.filter(visible).sort((a, b) => b.time.localeCompare(a.time));

        if (!posts.length) {
            listEl.innerHTML = `<div class="empty-state">这里空空如也，快 <a href="editor.html">写日志</a> 吧</div>`;
            return;
        }
        listEl.innerHTML = posts.map((p) => {
            const meta = metaOf(p.id);
            const ops = !isRepo || loggedIn
                ? `<span><a href="editor.html?id=${encodeURIComponent(p.id)}">编辑</a></span>
                   <span><a data-del="${esc(p.id)}" style="cursor:pointer">删除</a></span>`
                : "";
            return `
            <li class="blog-entry">
                <a class="blog-entry-title" href="post.html?id=${encodeURIComponent(p.id)}">${p.priv ? "🔒 " : ""}${esc(p.title)}</a>
                <p class="blog-entry-summary">${esc(p.content.slice(0, 90))}${p.content.length > 90 ? "……" : ""}</p>
                <div class="blog-entry-meta">
                    <span>${esc(p.time)}</span>
                    <span>分类：${esc(p.cate)}</span>
                    ${ops}
                </div>
            </li>`;
        }).join("");

        listEl.querySelectorAll("[data-del]").forEach((a) => {
            a.addEventListener("click", async () => {
                const id = a.dataset.del;
                if (isRepo) {
                    if (!confirm("确定从仓库删除这篇日志吗？（直接删除，不进回收站）")) return;
                    const r = await Session.deletePost(`posts/${id}.md`);
                    if (r.ok) {
                        toast("已删除，稍等部署生效");
                        const ir = await updatePostsIndex({ remove: id });
                        if (!ir || !ir.ok) toast("⚠️ 索引更新失败，若列表出现空壳条目请刷新重试删除");
                        const i = repoPosts.findIndex((p) => p.id === id);
                        if (i >= 0) repoPosts.splice(i, 1);
                        renderAll();
                    } else {
                        toast("删除失败：" + (r.error || "未知错误"));
                    }
                } else {
                    if (confirm("确定删除这篇日志吗？（会放入回收站）")) {
                        Store.updatePost(id, { deleted: true });
                        toast("已放入回收站");
                        renderAll();
                    }
                }
            });
        });
    }

    function allVisiblePosts() {
        return repoPosts.concat(localPosts());
    }

    function renderCates() {
        const posts = allVisiblePosts();
        const items = [["全部日志", posts.length, null]]
            .concat(Store.data.cates.map((c) => [c, posts.filter((p) => p.cate === c).length, c]));
        cateEl.innerHTML = items.map(([name, n, val]) =>
            `<li data-cate="${val ?? ""}" ${cateFilter === val ? 'style="color:var(--link)"' : ""}>
                <span>${esc(name)}</span><span>(${n})</span>
            </li>`).join("");
        cateEl.querySelectorAll("li").forEach((li) => {
            li.addEventListener("click", () => {
                cateFilter = li.dataset.cate || null;
                renderAll();
            });
        });
    }

    function renderArchive() {
        document.getElementById("yrLabel").textContent = year + "年";
        const box = document.getElementById("archiveMonths");
        box.innerHTML = "";
        for (let m = 1; m <= 12; m++) {
            const key = `${year}-${String(m).padStart(2, "0")}`;
            const n = allVisiblePosts().filter((p) => p.time.startsWith(key)).length;
            const cell = document.createElement("span");
            cell.textContent = n ? `${m}月(${n})` : `${m}月`;
            if (monthFilter === key) cell.style.color = "var(--link)";
            cell.addEventListener("click", () => {
                monthFilter = monthFilter === key ? null : key;
                renderAll();
            });
            box.appendChild(cell);
        }
    }

    function renderAll() { renderList(); renderCates(); renderArchive(); }

    /* Tab 切换 */
    document.querySelectorAll(".ptab[data-tab]").forEach((t) => {
        t.addEventListener("click", () => {
            document.querySelectorAll(".ptab[data-tab]").forEach((x) => x.classList.remove("active"));
            t.classList.add("active");
            tab = t.dataset.tab;
            renderList();
        });
    });

    document.getElementById("yrPrev").addEventListener("click", () => { year--; renderArchive(); });
    document.getElementById("yrNext").addEventListener("click", () => { year++; renderArchive(); });

    /* 草稿箱（本地） */
    document.getElementById("draftBox").addEventListener("click", () => {
        const drafts = Store.data.posts.filter((p) => p.draft && !p.deleted);
        const body = drafts.length
            ? `<ul class="modal-list">${drafts.map((p) => `
                <li><span class="ml-title">${esc(p.title) || "（无标题）"}</span>
                    <span class="ml-ops">
                        <a href="editor.html?id=${p.id}">继续编辑</a>
                        <a data-hard="${p.id}" style="color:#ff7a7a">删除</a>
                    </span></li>`).join("")}</ul>`
            : `<div class="modal-empty">草稿箱是空的（草稿只存在本浏览器）</div>`;
        const { mask } = modal("📄 草稿箱", body);
        mask.querySelectorAll("[data-hard]").forEach((a) => {
            a.addEventListener("click", () => {
                Store.removePost(a.dataset.hard);
                toast("已删除草稿");
                mask.remove();
            });
        });
    });

    /* 回收站（本地日志） */
    document.getElementById("recycleBin").addEventListener("click", () => {
        const bin = Store.data.posts.filter((p) => p.deleted);
        const body = bin.length
            ? `<ul class="modal-list">${bin.map((p) => `
                <li><span class="ml-title">${esc(p.title)}</span>
                    <span class="ml-ops">
                        <a data-restore="${p.id}">恢复</a>
                        <a data-hard="${p.id}" style="color:#ff7a7a">彻底删除</a>
                    </span></li>`).join("")}</ul>`
            : `<div class="modal-empty">回收站是空的（仅回收草稿和私密日记）</div>`;
        const { mask } = modal("🗑 回收站", body);
        mask.querySelectorAll("[data-restore]").forEach((a) => {
            a.addEventListener("click", () => {
                Store.updatePost(a.dataset.restore, { deleted: false });
                toast("已恢复");
                mask.remove();
                renderAll();
            });
        });
        mask.querySelectorAll("[data-hard]").forEach((a) => {
            a.addEventListener("click", () => {
                if (!confirm("彻底删除后无法恢复，确定吗？")) return;
                Store.removePost(a.dataset.hard);
                toast("已彻底删除");
                mask.remove();
                renderAll();
            });
        });
    });

    /* 分类管理 */
    document.getElementById("cateManage").addEventListener("click", () => {
        const body = `
            <ul class="modal-list">${Store.data.cates.map((c) => `
                <li><span class="ml-title">${esc(c)}</span>
                    <span class="ml-ops"><a data-rm="${esc(c)}" style="color:#ff7a7a">删除</a></span></li>`).join("")}
            </ul>
            <div style="display:flex;gap:8px;margin-top:12px">
                <input type="text" id="newCateInput" placeholder="新分类名称" maxlength="10">
                <button class="btn-blue" id="addCateBtn" style="padding:8px 14px;white-space:nowrap">添加</button>
            </div>`;
        const { mask } = modal("分类管理", body);
        mask.querySelector("#addCateBtn").addEventListener("click", () => {
            const v = mask.querySelector("#newCateInput").value.trim();
            if (!v) return;
            Store.addCate(v);
            toast("已添加分类");
            mask.remove();
            renderAll();
        });
        mask.querySelectorAll("[data-rm]").forEach((a) => {
            a.addEventListener("click", () => {
                const d = Store.data;
                d.cates = d.cates.filter((c) => c !== a.dataset.rm);
                Store.save();
                if (cateFilter === a.dataset.rm) cateFilter = null;
                mask.remove();
                renderAll();
            });
        });
    });

    document.getElementById("blogSetting").addEventListener("click", () => toast("评论审核等设置仅在原版 QQ 空间可用"));
    document.getElementById("tplBtn").addEventListener("click", () => toast("模板日志是黄钻特权哦（并没有实现）"));

    renderAll();
}

/* ============================================================
   写日志 / 编辑日志
   ============================================================ */
async function pageEditor() {
    const id = getQuery("id");
    let post = id ? (Store.getPost(id) || await RepoPosts.getById(id)) : null;
    const isRepoPost = !!(post && post.repo);
    /* 待发表图片：编辑期间只存本地，发表时才随文章一起提交 */
    let pendingImages = (post && post.images) || {};

    const titleEl = document.getElementById("edTitle");
    const cateEl = document.getElementById("edCate");
    const privEl = document.getElementById("edPriv");
    const contentEl = document.getElementById("edContent");
    const loggedIn = await Session.check();

    /* 登录状态栏 */
    const bar = document.getElementById("loginBar");
    if (bar) {
        if (loggedIn) {
            bar.innerHTML = `✅ 已登录站长账号 <b>${esc(Session.login)}</b>，写完点「发表」会直接上线
                <a id="logoutBtn" style="margin-left:12px;cursor:pointer">退出</a>`;
            bar.querySelector("#logoutBtn").addEventListener("click", () => {
                Session.logout();
                setTimeout(() => location.reload(), 600);
            });
        } else {
            bar.innerHTML = `这里是站长的写作台 ✍️ 访客请移步 <a href="blog.html">日志列表</a>
                <a id="loginBtn" style="margin-left:10px;cursor:pointer;color:var(--link)">站长登录</a>`;
            bar.querySelector("#loginBtn").addEventListener("click", () => Session.login());
        }
    }

    function fillCates(selected) {
        cateEl.innerHTML = Store.data.cates.map((c) =>
            `<option value="${esc(c)}" ${c === selected ? "selected" : ""}>${esc(c)}</option>`).join("");
    }
    fillCates(post ? post.cate : Store.data.cates[0]);

    if (post) {
        document.getElementById("editorTitle").textContent = post.draft ? "编辑草稿" : "编辑日志";
        document.title = "编辑日志 - SmarietVan的空间";
        titleEl.value = post.title;
        privEl.checked = !!post.priv;
        contentEl.value = post.content;
        if (isRepoPost) {
            privEl.checked = false;
            privEl.disabled = true;
            privEl.parentElement.title = "已发表的公开日志不能转私密，可删除后在私密日记重写";
        }
    }

    document.getElementById("edNewCate").addEventListener("click", () => {
        const name = prompt("新分类名称：");
        if (!name || !name.trim()) return;
        Store.addCate(name.trim());
        fillCates(name.trim());
    });

    function collect() {
        const title = titleEl.value.trim();
        const content = contentEl.value.trim();
        if (!title) { toast("标题还没写呢"); return null; }
        if (!content) { toast("正文还没写呢"); return null; }
        return { title, content, cate: cateEl.value, priv: privEl.checked };
    }

    /* 发表 */
    document.getElementById("edPublish").addEventListener("click", async () => {
        const p = collect();
        if (!p) return;

        /* 私密 → 永远只存本地 */
        if (p.priv) {
            if (post && !isRepoPost) Store.updatePost(post.id, { ...p, draft: false });
            else Store.addPost({ ...p, draft: false });
            toast("私密日记已保存（仅本浏览器可见）");
            setTimeout(() => (location.href = "blog.html"), 700);
            return;
        }

        /* 公开 + 已登录 → 图片和文章合成一个 commit 提交到仓库 */
        if (Session.ready && loggedIn) {
            const pid = isRepoPost ? post.id : newPostId();
            let md = RepoPosts.buildMd({ ...p, time: post ? post.time : Store.now() });

            const files = [];
            for (const [key, img] of Object.entries(pendingImages)) {
                files.push({ path: img.path, base64: img.dataURL.split(",")[1] });
                md = md.split(`pending:${key}`).join(img.path);
            }
            files.push({ path: `posts/${pid}.md`, text: md });
            let postIdx = [];
            try { postIdx = await fetch("posts/index.json?t=" + Date.now()).then((r) => (r.ok ? r.json() : [])); } catch { /* 视为空 */ }
            if (!postIdx.includes(pid + ".md")) postIdx.push(pid + ".md");
            files.push({ path: "posts/index.json", text: JSON.stringify(postIdx) });

            const imgCount = files.length - 1;
            toast(imgCount ? `正在提交（含 ${imgCount} 张图片）……` : "正在提交到仓库……");
            const r = await Session.commitFiles(files, `📝 ${isRepoPost ? "更新" : "发布"}日志 ${p.title}`);
            if (r.ok) {
                if (post && !isRepoPost) Store.removePost(post.id); // 草稿发表后移除本地
                pendingImages = {};
                RepoPosts.list = null;
                toast("已提交，稍等片刻自动上线");
                setTimeout(() => (location.href = "post.html?id=" + encodeURIComponent(pid)), 900);
            } else {
                toast("提交失败：" + (r.error || "未知错误"));
            }
            return;
        }

        /* 公开 + 未登录/未部署 → 导出 Markdown 手动提交 */
        const pid = isRepoPost ? post.id : newPostId();
        const md = RepoPosts.buildMd({ ...p, time: post ? post.time : Store.now() });
        const imgNote = Object.keys(pendingImages).length
            ? `<p style="color:#ffb347;margin-bottom:10px">⚠️ 本文含 ${Object.keys(pendingImages).length} 张插图，导出发布不会携带图片，建议点「站长登录」后直接发表。</p>`
            : "";
        modal("导出 Markdown（手动发布）", `
            ${imgNote}
            <p style="margin-bottom:10px;color:var(--card-dim)">
                未登录站长账号，无法直接提交。把下面内容保存为
                <b style="color:var(--accent)">posts/${esc(pid)}.md</b>，
                push 到仓库即可发布：
            </p>
            <textarea rows="12" id="exportMd" style="width:100%">${esc(md)}</textarea>
            <div class="modal-actions" style="padding:14px 0 0;border:none">
                <button class="btn-plain" id="copyMd">复制内容</button>
            </div>`);
        document.getElementById("copyMd").addEventListener("click", () => {
            const ta = document.getElementById("exportMd");
            ta.select();
            (navigator.clipboard?.writeText(ta.value) || Promise.reject())
                .then(() => toast("已复制"))
                .catch(() => { document.execCommand("copy"); toast("已复制"); });
        });
    });

    /* 存草稿（永远本地，连同待发表图片） */
    document.getElementById("edDraft").addEventListener("click", () => {
        const p = collect();
        if (!p) return;
        const payload = { ...p, draft: true, images: pendingImages };
        if (post && !isRepoPost) Store.updatePost(post.id, payload);
        else Store.addPost(payload);
        toast("已存入草稿箱（仅本浏览器）");
        setTimeout(() => (location.href = "blog.html"), 700);
    });

    document.getElementById("edCancel").addEventListener("click", () => history.back());

    /* 插入图片：编辑期只存本地并立刻可预览，发表时才随文章一起上传 */
    const imgPicker = document.createElement("input");
    imgPicker.type = "file";
    imgPicker.accept = "image/*";
    imgPicker.id = "imgPicker";
    imgPicker.hidden = true;
    document.body.appendChild(imgPicker);

    document.getElementById("edImage").addEventListener("click", () => imgPicker.click());

    imgPicker.addEventListener("change", async () => {
        const file = imgPicker.files[0];
        imgPicker.value = "";
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { toast("图片限 10MB"); return; }
        const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
        const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const dataURL = await fileToDataURL(file); // 压缩到 1000px 内
        pendingImages[key] = { path: `assets/img/posts/${key}.${ext}`, dataURL };
        const md = `\n![${file.name.replace(/\.\w+$/, "")}](pending:${key})\n`;
        const ta = contentEl;
        const pos = ta.selectionStart ?? ta.value.length;
        ta.value = ta.value.slice(0, pos) + md + ta.value.slice(pos);
        if (!previewArea.classList.contains("hidden")) renderPreview();
        toast("图片已插入（发表时才会上传）");
    });

    /* 预览切换（开着预览时实时刷新） */
    const previewArea = document.getElementById("previewArea");
    const previewBtn = document.getElementById("edPreviewBtn");

    function renderPreview() {
        let md = contentEl.value || "*（还没有内容）*";
        // 待发表图片：替换成本地 dataURL 立即预览
        md = md.replace(/\(pending:([\w-]+)\)/g, (m, k) =>
            "(" + (pendingImages[k] ? pendingImages[k].dataURL : m) + ")");
        if (typeof marked !== "undefined") {
            previewArea.innerHTML = marked.parse(md, { breaks: true });
        } else {
            renderMd(previewArea, md);
        }
    }

    previewBtn.addEventListener("click", () => {
        const showing = !previewArea.classList.contains("hidden");
        if (showing) {
            previewArea.classList.add("hidden");
            contentEl.classList.remove("hidden");
            previewBtn.textContent = "👁 预览";
        } else {
            renderPreview();
            contentEl.classList.add("hidden");
            previewArea.classList.remove("hidden");
            previewBtn.textContent = "✏️ 继续编辑";
        }
    });

    contentEl.addEventListener("input", () => {
        if (!previewArea.classList.contains("hidden")) renderPreview();
    });
}

function newPostId() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${Math.random().toString(36).slice(2, 5)}`;
}

/* ============================================================
   日志详情页
   ============================================================ */
async function pagePost() {
    const id = getQuery("id");
    const box = document.getElementById("postDetail");

    const local = Store.getPost(id);
    const post = local || await RepoPosts.getById(id);

    if (!post || post.deleted) {
        box.innerHTML = `<div class="empty-state">这篇日志不存在、已被删除，或刚提交还在部署中（稍后刷新试试）<br><br><a href="blog.html">« 返回日志列表</a></div>`;
        return;
    }

    const isRepo = !!post.repo;
    const meta = metaOf(id);
    document.title = post.title + " - SmarietVan的空间";

    const loggedIn = isRepo ? await Session.check() : true;

    function render() {
        const liked = Liked.has(id);
        const tools = loggedIn
            ? `<a href="editor.html?id=${encodeURIComponent(id)}">✏️ 编辑</a>
               <a id="pdDelete" style="color:#ff7a7a;cursor:pointer">🗑 删除</a>`
            : "";
        box.innerHTML = `
            <div class="pd-title">${post.priv ? '<span class="lock-tag">🔒 私密</span> ' : ""}${esc(post.title)}</div>
            <div class="pd-meta">
                <span>${esc(post.time)}</span>
                <span>分类：${esc(post.cate)}</span>
                <span>阅读 <span id="busuanzi_value_page_pv">--</span></span>
            </div>
            <div class="pd-content md-body" id="pdContent"></div>
            <div class="pd-tools">
                ${tools}
                <a href="blog.html">« 返回日志列表</a>
            </div>
            <div class="pd-foot">
                <span></span>
                <span class="actions">
                    <button class="act like-btn ${liked ? "liked" : ""}" id="pdLike">👍 <i>${meta.likes}</i></button>
                </span>
            </div>
            <div class="pd-comments" id="comments">
                <div class="pd-comments-title">评论</div>
                <div id="commentList"><div class="comment-loading">正在读取评论……</div></div>
                <div class="comment-form">
                    <a class="btn-blue" style="text-decoration:none;align-self:flex-start" target="_blank" rel="noopener"
                       href="${GhComments.commentUrl(id, post.title)}">💬 用 GitHub 账号评论</a>
                    <p class="comment-hint">评论会以你的 GitHub 用户名提交，站长审核通过后展示在这里</p>
                </div>
            </div>`;

        /* 异步加载已通过的评论 */
        GhComments.approved(id).then((list) => {
            const box = document.getElementById("commentList");
            if (!box) return;
            if (!list.length) {
                box.innerHTML = '<div style="font-size:13px;color:var(--card-dim);padding:6px 0">还没有已通过的评论，来抢沙发～</div>';
                return;
            }
            box.innerHTML = list.map((c) => `
                <div class="comment-item">
                    <img class="ci-avatar gh" src="${c.avatar}" alt="" loading="lazy">
                    <div class="ci-body">
                        <a class="ci-name" href="${c.url}" target="_blank" rel="noopener">${esc(c.author)}<span class="ci-time">${esc(c.time)}</span></a>
                        <div class="ci-text">${esc(c.text)}</div>
                    </div>
                </div>`).join("");
            const title = document.querySelector(".pd-comments-title");
            if (title) title.textContent = `评论（${list.length}）`;
        });

        renderMd(document.getElementById("pdContent"), post.content);

        document.getElementById("pdLike").addEventListener("click", (e) => {
            const likedNow = Liked.toggle(id);
            meta.likes += likedNow ? 1 : -1;
            Store.saveMeta();
            const btn = e.currentTarget;
            btn.classList.toggle("liked", likedNow);
            btn.querySelector("i").textContent = meta.likes;
        });

        const delBtn = document.getElementById("pdDelete");
        if (delBtn) {
            delBtn.addEventListener("click", async () => {
                if (isRepo) {
                    if (!confirm("确定从仓库删除这篇日志吗？（直接删除，不进回收站）")) return;
                    const r = await Session.deletePost(`posts/${id}.md`);
                    if (r.ok) {
                        RepoPosts.list = null;
                        toast("已删除，稍等部署生效");
                        const ir = await updatePostsIndex({ remove: id });
                        if (!ir || !ir.ok) toast("⚠️ 索引更新失败，若列表出现空壳条目请重新删除一次");
                        setTimeout(() => (location.href = "blog.html"), 900);
                    } else {
                        toast("删除失败：" + (r.error || "未知错误"));
                    }
                } else {
                    if (confirm("确定删除这篇日志吗？（会放入回收站）")) {
                        Store.updatePost(id, { deleted: true });
                        toast("已放入回收站");
                        setTimeout(() => (location.href = "blog.html"), 600);
                    }
                }
            });
        }

    }

    /* 真实阅读量：不蒜子页面级 PV（按 URL 计数，PJAX 跳转也注入计数） */
    if (window.__bszForPost !== id) {
        window.__bszForPost = id;
        const s = document.createElement("script");
        s.src = "//busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js";
        s.async = true;
        document.body.appendChild(s);
    }

    render();
}

/* ============================================================
   相册列表页
   ============================================================ */

/* 图片压缩（localStorage 空间有限，统一压到 1000px 内的 jpeg） */
function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                const MAX = 1000;
                const scale = Math.min(1, MAX / Math.max(img.width, img.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/jpeg", 0.82));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function pickPhotos(onDone) {
    const picker = document.getElementById("filePicker");
    picker.value = "";
    picker.onchange = async () => {
        const files = [...picker.files];
        if (!files.length) return;
        let ok = 0;
        for (const f of files) {
            try {
                const src = await fileToDataURL(f);
                if (onDone(f.name.replace(/\.\w+$/, ""), src) !== false) ok++;
                else { toast("浏览器存储空间不足，部分照片未保存"); break; }
            } catch { /* 跳过坏文件 */ }
        }
        if (ok) toast(`已上传 ${ok} 张照片`);
    };
    picker.click();
}

function pageAlbum() {
    const grid = document.getElementById("albumGrid");

    function render() {
        const albums = Store.data.albums.filter((a) => !a.deleted);
        if (!albums.length) {
            grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">还没有相册，点「创建相册」建一个吧</div>`;
            return;
        }
        grid.innerHTML = albums.map((a) => {
            const cover = a.photos.length
                ? `<img src="${a.photos[0].src}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:4px" alt="">`
                : "📷";
            return `
            <a class="photo-album" href="album-view.html?id=${a.id}">
                <div class="photo-cover">${cover}<span class="photo-num">${a.photos.length}</span></div>
                <div class="photo-name">${esc(a.name)} ${a.lock ? '<span class="lock">🔒</span>' : ""}</div>
            </a>`;
        }).join("");
    }

    /* 创建相册 */
    document.getElementById("createAlbumBtn").addEventListener("click", () => {
        const { mask } = modal("创建相册", `
            <input type="text" id="naName" placeholder="相册名称" maxlength="20">
            <label class="checkbox-row"><input type="checkbox" id="naLock"> 加锁（私密相册）</label>
            <div class="modal-actions" style="padding:14px 0 0;border:none">
                <button class="btn-blue" id="naOk">创建</button>
            </div>`);
        mask.querySelector("#naOk").addEventListener("click", () => {
            const name = mask.querySelector("#naName").value.trim();
            if (!name) { toast("相册名不能为空"); return; }
            Store.addAlbum(name, mask.querySelector("#naLock").checked);
            toast("相册创建成功");
            mask.remove();
            render();
        });
    });

    /* 上传照片：先选相册 */
    document.getElementById("uploadBtn").addEventListener("click", () => {
        const albums = Store.data.albums.filter((a) => !a.deleted);
        if (!albums.length) { toast("先创建一个相册再上传吧"); return; }
        const { mask, close } = modal("上传到哪个相册？", `
            <ul class="modal-list">${albums.map((a) => `
                <li><span class="ml-title">${esc(a.name)}</span>
                    <span class="ml-ops"><a data-pick="${a.id}">选择</a></span></li>`).join("")}</ul>`);
        mask.querySelectorAll("[data-pick]").forEach((a) => {
            a.addEventListener("click", () => {
                const albumId = a.dataset.pick;
                close();
                pickPhotos((name, src) => Store.addPhoto(albumId, name, src));
                setTimeout(render, 300);
            });
        });
    });

    /* 回收站 */
    document.getElementById("albumRecycle").addEventListener("click", () => {
        const bin = Store.data.albums.filter((a) => a.deleted);
        const body = bin.length
            ? `<ul class="modal-list">${bin.map((a) => `
                <li><span class="ml-title">${esc(a.name)}（${a.photos.length}张）</span>
                    <span class="ml-ops">
                        <a data-restore="${a.id}">恢复</a>
                        <a data-hard="${a.id}" style="color:#ff7a7a">彻底删除</a>
                    </span></li>`).join("")}</ul>`
            : `<div class="modal-empty">回收站是空的</div>`;
        const { mask } = modal("🗑 相册回收站", body);
        mask.querySelectorAll("[data-restore]").forEach((a) => {
            a.addEventListener("click", () => {
                Store.updateAlbum(a.dataset.restore, { deleted: false });
                toast("已恢复");
                mask.remove();
                render();
            });
        });
        mask.querySelectorAll("[data-hard]").forEach((a) => {
            a.addEventListener("click", () => {
                if (!confirm("彻底删除后无法恢复，确定吗？")) return;
                const d = Store.data;
                d.albums = d.albums.filter((x) => x.id !== a.dataset.hard);
                Store.save();
                toast("已彻底删除");
                mask.remove();
                render();
            });
        });
    });

    document.getElementById("tabPhotos").addEventListener("click", () => {
        const total = Store.data.albums.filter((a) => !a.deleted).reduce((s, a) => s + a.photos.length, 0);
        toast(`全部照片共 ${total} 张，点进相册查看`);
    });
    document.getElementById("tabVideos").addEventListener("click", () => toast("视频功能暂未开放"));
    document.getElementById("albumApps").addEventListener("click", () => toast("相册应用是原版 QQ 空间的功能哦"));
    document.getElementById("displaySettingBtn").addEventListener("click", () => toast("当前为默认封面模式"));

    render();
}

/* ============================================================
   相册详情页
   ============================================================ */
function pageAlbumView() {
    const id = getQuery("id");
    const album = Store.getAlbum(id);
    const grid = document.getElementById("photoGrid");

    if (!album || album.deleted) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">相册不存在或已删除<br><br><a href="album.html">« 返回相册列表</a></div>`;
        document.getElementById("albumName").textContent = "相册";
        return;
    }

    document.getElementById("albumName").textContent = album.name + (album.lock ? " 🔒" : "");
    document.title = album.name + " - 相册 - SmarietVan的空间";

    const lb = document.getElementById("lightbox");
    let currentPhotoId = null;

    function render() {
        if (!album.photos.length) {
            grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">还没有照片，点「上传照片」添加吧</div>`;
            return;
        }
        grid.innerHTML = album.photos.map((p) => `
            <div class="photo-item" data-pid="${p.id}" title="${esc(p.name)}">
                <img src="${p.src}" alt="${esc(p.name)}">
            </div>`).join("");
        grid.querySelectorAll(".photo-item").forEach((el) => {
            el.addEventListener("click", () => {
                const p = album.photos.find((x) => x.id === el.dataset.pid);
                if (!p) return;
                currentPhotoId = p.id;
                document.getElementById("lbImg").src = p.src;
                document.getElementById("lbName").textContent = p.name;
                lb.classList.remove("hidden");
            });
        });
    }

    document.getElementById("lbClose").addEventListener("click", () => lb.classList.add("hidden"));
    lb.addEventListener("click", (e) => { if (e.target === lb) lb.classList.add("hidden"); });
    document.getElementById("lbDelete").addEventListener("click", () => {
        if (!currentPhotoId) return;
        Store.delPhoto(album.id, currentPhotoId);
        lb.classList.add("hidden");
        toast("照片已删除");
        render();
    });

    document.getElementById("uploadPhotoBtn").addEventListener("click", () => {
        pickPhotos((name, src) => {
            const ok = Store.addPhoto(album.id, name, src);
            render();
            return ok;
        });
    });

    document.getElementById("renameAlbumBtn").addEventListener("click", () => {
        const name = prompt("相册新名称：", album.name);
        if (!name || !name.trim()) return;
        Store.updateAlbum(album.id, { name: name.trim() });
        document.getElementById("albumName").textContent = name.trim() + (album.lock ? " 🔒" : "");
        toast("已重命名");
    });

    document.getElementById("deleteAlbumBtn").addEventListener("click", () => {
        if (confirm(`确定删除相册「${album.name}」吗？（会放入回收站）`)) {
            Store.updateAlbum(album.id, { deleted: true });
            toast("已放入回收站");
            setTimeout(() => (location.href = "album.html"), 600);
        }
    });

    render();
}

/* ============================================================
   留言板
   ============================================================ */
function pageGuestbook() {
    const greetEl = document.getElementById("greetText");

    function renderGreet() {
        greetEl.textContent = Store.data.settings.greeting;
    }

    /* 留言板设置：编辑主人寄语 */
    document.getElementById("gbSetting").addEventListener("click", () => {
        const { mask } = modal("留言板设置", `
            <label style="font-size:13px;color:var(--card-dim)">主人寄语</label>
            <textarea id="greetInput" rows="3" style="margin-top:8px">${esc(Store.data.settings.greeting)}</textarea>
            <div class="modal-actions" style="padding:14px 0 0;border:none">
                <button class="btn-blue" id="greetOk">保存</button>
            </div>`);
        mask.querySelector("#greetOk").addEventListener("click", () => {
            Store.data.settings.greeting = mask.querySelector("#greetInput").value.trim() || "欢迎光临！";
            Store.save();
            renderGreet();
            toast("寄语已更新");
            mask.remove();
        });
    });

    document.getElementById("gbSign").addEventListener("click", () => toast("签名档功能暂未开放"));

    /* Giscus 配置好了就用 Giscus，否则用本地留言 */
    if (typeof GISCUS_CONFIG !== "undefined" && GISCUS_CONFIG.repoId && GISCUS_CONFIG.categoryId) {
        document.getElementById("msgArea").style.display = "none";
        document.getElementById("msgCount").textContent = "-";
        return;
    }
    document.getElementById("giscus-container").remove();

    const listEl = document.getElementById("msgList");

    function render() {
        const msgs = Store.data.msgs;
        document.getElementById("msgCount").textContent = msgs.length;
        if (!msgs.length) {
            listEl.innerHTML = `<div class="empty-state">还没有人发表留言，来坐第一个沙发～</div>`;
            return;
        }
        listEl.innerHTML = msgs.map((m, i) => {
            const floor = i === 0 ? "沙发" : i === 1 ? "板凳" : `${msgs.length - i} 楼`;
            return `
            <li class="msg-item">
                <span class="ci-avatar">${avatarOf(m.name)}</span>
                <div class="ci-body">
                    <span class="ci-name">${esc(m.name)}<span class="ci-time">${esc(m.time)}</span></span>
                    <div class="ci-text">${esc(m.text)}</div>
                    <div class="msg-floor">${floor}</div>
                </div>
            </li>`;
        }).join("");
    }

    document.getElementById("msgSubmit").addEventListener("click", () => {
        const name = document.getElementById("msgName").value.trim() || "匿名访客";
        const text = document.getElementById("msgText").value.trim();
        if (!text) { toast("留言内容不能为空"); return; }
        Store.addMsg(name, text);
        document.getElementById("msgText").value = "";
        toast("留言成功，感谢不跑堂！");
        render();
    });

    renderGreet();
    render();
}

/* ============================================================
   站长后台：评论审核（仅站长）
   ============================================================ */
async function pageAdmin() {
    const box = document.getElementById("adminBody");
    const loggedIn = await Session.check();

    if (!loggedIn) {
        box.innerHTML = `
            <div class="empty-state">
                这里是站长后台，仅站长可见<br><br>
                <a id="adminLogin" style="cursor:pointer;color:var(--link)">站长登录</a>
            </div>`;
        document.getElementById("adminLogin").addEventListener("click", () => Session.login());
        return;
    }

    let tab = "pending"; // pending | approved

    function issueRow(i, actions) {
        const m = /^\[(.+?)\]\s*(.*)$/.exec(i.title);
        const postId = m ? m[1] : "";
        return `
        <li class="comment-item">
            <img class="ci-avatar gh" src="${i.user.avatar_url}" alt="" loading="lazy">
            <div class="ci-body">
                <a class="ci-name" href="${i.user.html_url}" target="_blank" rel="noopener">${esc(i.user.login)}</a>
                <span class="ci-time">${esc(i.created_at.slice(0, 16).replace("T", " "))}</span>
                ${postId ? `<div class="admin-post-ref">评论于：<a href="post.html?id=${encodeURIComponent(postId)}" target="_blank">${esc(postId)}</a></div>` : ""}
                <div class="ci-text">${esc(i.body || "")}</div>
                <div class="admin-ops">${actions}</div>
            </div>
        </li>`;
    }

    async function render() {
        box.innerHTML = `<div class="empty-state">加载中……</div>`;
        if (tab === "pending") {
            const list = await GhComments.pending();
            if (!list) { box.innerHTML = `<div class="empty-state">读取失败，请重新登录</div>`; return; }
            box.innerHTML = list.length
                ? `<ul class="msg-list">${list.map((i) => issueRow(i,
                    `<a data-approve="${i.number}">✅ 通过</a><a data-reject="${i.number}" class="danger">❌ 拒绝</a>`)).join("")}</ul>`
                : `<div class="empty-state">没有待审核的评论，世界和平 🕊️</div>`;
            box.querySelectorAll("[data-approve]").forEach((a) => {
                a.addEventListener("click", async () => {
                    if (await GhComments.approve(+a.dataset.approve)) { toast("已通过，现在公开可见"); render(); }
                    else toast("操作失败");
                });
            });
            box.querySelectorAll("[data-reject]").forEach((a) => {
                a.addEventListener("click", async () => {
                    if (!confirm("拒绝并关闭这条评论？")) return;
                    if (await GhComments.reject(+a.dataset.reject)) { toast("已拒绝"); render(); }
                    else toast("操作失败");
                });
            });
        } else {
            const list = await GhComments.approvedAll();
            if (!list) { box.innerHTML = `<div class="empty-state">读取失败，请重新登录</div>`; return; }
            box.innerHTML = list.length
                ? `<ul class="msg-list">${list.map((i) => issueRow(i,
                    `<a data-revoke="${i.number}" class="danger">撤下</a>`)).join("")}</ul>`
                : `<div class="empty-state">还没有已通过审核的评论</div>`;
            box.querySelectorAll("[data-revoke]").forEach((a) => {
                a.addEventListener("click", async () => {
                    if (await GhComments.revoke(+a.dataset.revoke)) { toast("已撤下（回到待审核）"); render(); }
                    else toast("操作失败");
                });
            });
        }
    }

    document.querySelectorAll(".ptab[data-atab]").forEach((t) => {
        t.addEventListener("click", () => {
            document.querySelectorAll(".ptab[data-atab]").forEach((x) => x.classList.remove("active"));
            t.classList.add("active");
            tab = t.dataset.atab;
            render();
        });
    });

    render();
}

/* ============================================================
   音乐盒
   ============================================================ */
async function pageMusic() {
    const listEl = document.getElementById("trackList");
    const curName = document.getElementById("curName");
    const curTime = document.getElementById("curTime");
    const bar = document.getElementById("playBar");
    const fill = document.getElementById("playFill");
    const loggedIn = await Session.check();
    const audio = Player.audio;

    function fmt(s) {
        if (!isFinite(s)) return "--:--";
        return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    }

    function renderList() {
        if (!Player.tracks.length) {
            listEl.innerHTML = `<div class="empty-state">还没有歌曲${loggedIn ? "，点上方「上传歌曲」传几首吧" : ""}</div>`;
            return;
        }
        listEl.innerHTML = Player.tracks.map((t, i) => `
            <li class="track-item ${i === Player.idx ? "playing" : ""}" data-i="${i}">
                <span class="track-no">${i === Player.idx ? "🎵" : i + 1}</span>
                <span class="track-name">${esc(t.name)}</span>
                ${loggedIn ? `<span class="track-del" data-del="${i}" title="删除">🗑</span>` : ""}
            </li>`).join("");

        listEl.querySelectorAll(".track-item").forEach((el) => {
            el.addEventListener("click", (e) => {
                if (e.target.closest(".track-del")) return;
                Player.playAt(+el.dataset.i);
                renderList();
            });
        });
        listEl.querySelectorAll("[data-del]").forEach((el) => {
            el.addEventListener("click", async () => {
                const i = +el.dataset.del;
                const t = Player.tracks[i];
                if (!confirm(`删除歌曲「${t.name}」？`)) return;
                toast("正在删除……");
                const dr = await Session.deleteFile(t.path, `🗑 删除歌曲 ${t.name}`);
                if (!dr.ok) { toast("删除失败：" + (dr.error || "")); return; }
                Player.tracks.splice(i, 1);
                if (Player.idx === i) { audio.pause(); Player.idx = -1; }
                else if (Player.idx > i) Player.idx--;
                await Session.commitFiles([{ path: "data/music.json", text: JSON.stringify(Player.tracks, null, 2) }], "🎵 更新歌单");
                toast("已删除");
                renderList();
            });
        });
    }

    function syncCur() {
        curName.textContent = Player.idx >= 0 ? Player.tracks[Player.idx].name : "未在播放";
    }

    document.getElementById("btnPrev").addEventListener("click", () => { Player.prev(); syncCur(); renderList(); });
    document.getElementById("btnNext").addEventListener("click", () => { Player.next(); syncCur(); renderList(); });
    document.getElementById("btnPlay").addEventListener("click", () => Player.toggle());

    if (!audio._musicBound) {
        audio._musicBound = true;
        audio.addEventListener("play", () => {
            const b = document.getElementById("btnPlay");
            if (b) b.textContent = "⏸";
            const cn = document.getElementById("curName");
            if (cn && Player.idx >= 0) cn.textContent = Player.tracks[Player.idx].name;
        });
        audio.addEventListener("pause", () => {
            const b = document.getElementById("btnPlay");
            if (b) b.textContent = "▶";
        });
        audio.addEventListener("timeupdate", () => {
            const f = document.getElementById("playFill");
            const t = document.getElementById("curTime");
            if (!audio.duration || !f || !t) return;
            f.style.width = (audio.currentTime / audio.duration * 100) + "%";
            t.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
        });
        document.addEventListener("player:change", () => {
            const cn = document.getElementById("curName");
            if (cn && Player.idx >= 0) cn.textContent = Player.tracks[Player.idx].name;
            const tl = document.getElementById("trackList");
            if (tl) {
                tl.querySelectorAll(".track-item").forEach((el) => {
                    el.classList.toggle("playing", +el.dataset.i === Player.idx);
                    el.querySelector(".track-no").textContent = +el.dataset.i === Player.idx ? "🎵" : (+el.dataset.i + 1);
                });
            }
        });
    }

    bar.addEventListener("click", (e) => {
        if (!audio.duration) return;
        const r = bar.getBoundingClientRect();
        audio.currentTime = audio.duration * (e.clientX - r.left) / r.width;
    });
    document.addEventListener("player:change", () => { syncCur(); renderList(); });

    /* 上传歌曲（站长，多选） */
    const upBtn = document.getElementById("uploadSongsBtn");
    if (loggedIn) {
        const picker = document.createElement("input");
        picker.type = "file";
        picker.accept = "audio/*";
        picker.multiple = true;
        picker.hidden = true;
        document.body.appendChild(picker);

        const panel = document.getElementById("uploadPanel");
        const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.ceil(n / 1024) + " KB";

        function showPanel(rows) {
            panel.classList.remove("hidden");
            panel.innerHTML = `
                <div class="up-title">⏫ 正在上传 ${rows.length} 首歌</div>
                <ul class="up-list">${rows.map((r, i) => `
                    <li data-row="${i}">
                        <span class="up-name">${esc(r.name)} <i>${fmtSize(r.size)}</i></span>
                        <span class="up-state">等待</span>
                    </li>`).join("")}</ul>
                <div class="up-step" id="upStep"></div>`;
        }
        function setRow(i, text, cls) {
            const el = panel.querySelector(`[data-row="${i}"] .up-state`);
            if (el) { el.textContent = text; el.className = "up-state " + (cls || ""); }
        }
        function setStep(text) {
            const el = document.getElementById("upStep");
            if (el) el.textContent = text;
        }

        upBtn.addEventListener("click", () => picker.click());
        picker.addEventListener("change", async () => {
            const files = [...picker.files].filter((f) => {
                if (f.size > 30 * 1024 * 1024) { toast(`「${f.name}」超过 30MB，跳过`); return false; }
                return true;
            });
            picker.value = "";
            if (!files.length) return;

            showPanel(files);
            const commitFiles = [];
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                setRow(i, "读取中…", "doing");
                setStep(`第 1 步 / 共 2 步：读取文件 ${i + 1}/${files.length}`);
                const dataUrl = await new Promise((res, rej) => {
                    const fr = new FileReader();
                    fr.onload = () => res(fr.result);
                    fr.onerror = rej;
                    fr.readAsDataURL(f);
                });
                const ext = (f.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
                const path = `assets/music/s-${Date.now().toString(36)}-${i}.${ext}`;
                commitFiles.push({ path, base64: dataUrl.split(",")[1], _row: i });
                Player.tracks.push({ name: f.name.replace(/\.\w+$/, ""), path });
                setRow(i, "已读取，待上传");
            }
            commitFiles.push({ path: "data/music.json", text: JSON.stringify(Player.tracks, null, 2) });

            const r = await Session.commitFiles(commitFiles, "🎵 上传歌曲", (stage, i, total) => {
                if (stage === "blob") {
                    setStep(`第 2 步 / 共 2 步：上传文件 ${i}/${total}（含歌单配置）`);
                    const row = commitFiles[i - 1];
                    if (row && row._row !== undefined) setRow(row._row, "上传中…", "doing");
                    if (i > 1 && commitFiles[i - 2] && commitFiles[i - 2]._row !== undefined) setRow(commitFiles[i - 2]._row, "已上传 ✓", "done");
                } else if (stage === "tree") {
                    setStep("收尾：生成提交……");
                    commitFiles.forEach((f) => { if (f._row !== undefined) setRow(f._row, "已上传 ✓", "done"); });
                } else if (stage === "commit") setStep("收尾：创建 commit……");
                else if (stage === "ref") setStep("收尾：更新分支……");
            });

            if (r.ok) {
                setStep("✅ 全部完成，约 1 分钟后访客可听");
                document.getElementById("upPanel").querySelector(".up-title").textContent = "上传完成";
                renderList();
                setTimeout(() => panel.classList.add("hidden"), 5000);
            } else {
                setStep("❌ 失败：" + (r.error || "未知错误") + "（可重新上传）");
            }
        });
    } else {
        upBtn.classList.add("owner-only");
    }

    syncCur();
    renderList();
}

/* ============================================================
   站点设置（仅站长，配置存仓库 data/site.json，全站可见）
   ============================================================ */
async function pageSettings() {
    const box = document.getElementById("settingsBody");
    const loggedIn = await Session.check();

    if (!loggedIn) {
        box.innerHTML = `
            <div class="empty-state">
                站点设置仅站长可用<br><br>
                <a id="setLogin" style="cursor:pointer;color:var(--link)">站长登录</a>
            </div>`;
        document.getElementById("setLogin").addEventListener("click", () => Session.login());
        return;
    }

    const c = SiteCfg.data || {};
    const profileText = (c.profile || [
        "📇|代码搬砖工 · 男 · 现居赛博空间",
        "💼|人生娱乐公司",
        "📍|来自 github.com/SmarietVan",
        "✍️|Talk is cheap. Show me the code.",
    ]).join("\n");

    box.innerHTML = `
        <div class="set-form">
            <label class="set-label">空间名称</label>
            <input type="text" id="setSpaceName" value="${esc(c.spaceName || "SmarietVan的空间")}" maxlength="30">
            <label class="set-label">主人昵称</label>
            <input type="text" id="setNick" value="${esc(c.ownerNick || "SmarietVan")}" maxlength="20">
            <label class="set-label">个人档（每行一条，格式：emoji|内容）</label>
            <textarea id="setProfile" rows="5">${esc(profileText)}</textarea>

            ${["banner", "pageBg"].map((k) => {
                const conf = c[k] || {};
                const label = k === "banner" ? "顶部横幅背景" : "页面背景";
                return `
                <div class="set-bg" data-key="${k}">
                    <label class="set-label">${label}</label>
                    <label class="set-radio"><input type="radio" name="${k}Mode" value="theme" ${(!conf.mode || conf.mode === "theme") ? "checked" : ""}> 跟随皮肤</label>
                    <label class="set-radio"><input type="radio" name="${k}Mode" value="color" ${conf.mode === "color" ? "checked" : ""}> 纯色
                        <input type="color" class="set-color" value="${conf.color || (k === "banner" ? "#0a1f4d" : "#eef1f5")}"></label>
                    <label class="set-radio"><input type="radio" name="${k}Mode" value="image" ${conf.mode === "image" ? "checked" : ""}> 自定义图片
                        <button class="btn-plain set-img-btn" type="button">选择图片</button>
                        <span class="set-img-name">${conf.image ? "当前：" + esc(conf.image) : "未选择"}</span></label>
                </div>`;
            }).join("")}

            <div class="ed-actions">
                <button class="btn-blue" id="setSave">保存设置</button>
                <span style="font-size:12px;color:var(--card-dim)">保存后约 1 分钟全站生效，所有访客可见</span>
            </div>
        </div>`;

    /* 背景图选择（存本地待提交） */
    const pendingBgs = {};
    box.querySelectorAll(".set-bg").forEach((wrap) => {
        const key = wrap.dataset.key;
        const picker = document.createElement("input");
        picker.type = "file";
        picker.accept = "image/*";
        picker.hidden = true;
        box.appendChild(picker);
        wrap.querySelector(".set-img-btn").addEventListener("click", () => picker.click());
        picker.addEventListener("change", async () => {
            const f = picker.files[0];
            picker.value = "";
            if (!f) return;
            const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
            const dataURL = await fileToDataURL(f);
            pendingBgs[key] = { path: `assets/img/bg/${key}-${Date.now().toString(36)}.${ext}`, dataURL };
            wrap.querySelector(".set-img-name").textContent = "已选择：" + f.name;
            wrap.querySelector(`input[value=image]`).checked = true;
        });
    });

    document.getElementById("setSave").addEventListener("click", async () => {
        const cfg = {
            spaceName: document.getElementById("setSpaceName").value.trim() || "SmarietVan的空间",
            ownerNick: document.getElementById("setNick").value.trim() || "SmarietVan",
            profile: document.getElementById("setProfile").value.split("\n").map((s) => s.trim()).filter(Boolean),
            banner: { mode: box.querySelector('input[name=bannerMode]:checked').value, color: box.querySelectorAll(".set-color")[0].value, image: (c.banner && c.banner.image) || "" },
            pageBg: { mode: box.querySelector('input[name=pageBgMode]:checked').value, color: box.querySelectorAll(".set-color")[1].value, image: (c.pageBg && c.pageBg.image) || "" },
        };

        const files = [{ path: "data/site.json", text: JSON.stringify(cfg, null, 2) }];
        for (const [k, img] of Object.entries(pendingBgs)) {
            cfg[k].image = img.path;
            files.push({ path: img.path, base64: img.dataURL.split(",")[1] });
            files[0].text = JSON.stringify(cfg, null, 2);
        }

        toast("正在保存设置……");
        const r = await Session.commitFiles(files, "⚙️ 更新站点设置");
        if (r.ok) {
            SiteCfg.data = cfg;
            SiteCfg.apply();
            toast("已保存，约 1 分钟全站生效");
        } else {
            toast("保存失败：" + (r.error || "未知错误"));
        }
    });
}

/* ---------- 启动 ---------- */
Session.init();
Player.init();
SiteCfg.load();

/* 顶栏注入「音乐盒」导航 */
(function initNavInject() {
    const dress = document.querySelector(".dress");
    if (!dress) return;
    const a = document.createElement("a");
    a.className = "topnav-item" + (document.body.dataset.page === "music" ? " active" : "");
    a.href = "music.html";
    a.textContent = "音乐盒";
    dress.parentElement.insertBefore(a, dress);
})();

/* 站长模式：token 校验通过才显示编辑入口 */
(async function initOwnerMode() {
    if (!Session.ready) return;
    if (await Session.check()) document.documentElement.classList.add("owner");
})();

/* 页脚站长入口（换设备从这里登录） */
(function initOwnerEntry() {
    const f = document.querySelector(".footer");
    if (!f) return;
    const a = document.createElement("a");
    a.href = "editor.html";
    a.textContent = "站长入口";
    a.style.cssText = "margin-left:12px;opacity:.6";
    f.appendChild(a);
    const admin = document.createElement("a");
    admin.href = "admin.html";
    admin.textContent = "评论审核";
    admin.className = "owner-only";
    admin.style.cssText = "margin-left:12px";
    f.appendChild(admin);
    const set = document.createElement("a");
    set.href = "settings.html";
    set.textContent = "站点设置";
    set.className = "owner-only";
    set.style.cssText = "margin-left:12px";
    f.appendChild(set);
})();

/* ---------- 顶栏音乐上传按钮 → 音乐盒（站长） ---------- */
(function initMusicUpload() {
    const player = document.getElementById("musicPlayer");
    if (!player) return;

    const btn = document.createElement("button");
    btn.className = "music-play owner-only";
    btn.textContent = "⬆";
    btn.title = "去音乐盒上传歌曲（站长）";
    player.insertBefore(btn, player.firstChild);
    btn.addEventListener("click", () => (location.href = "music.html"));
})();

const App = {
    initPage() {
        const fn = {
            home: pageHome,
            blog: pageBlog,
            editor: pageEditor,
            post: pagePost,
            album: pageAlbum,
            "album-view": pageAlbumView,
            guestbook: pageGuestbook,
            admin: pageAdmin,
            music: pageMusic,
            settings: pageSettings,
        }[document.body.dataset.page];
        if (fn) fn();
        if (SiteCfg.data) SiteCfg.apply();
    },
};
App.initPage();

/* ============================================================
   PJAX 站内跳转：只替换内容区，顶栏和播放器不刷新，音乐不断
   ============================================================ */
const PJAX = {
    KEEP: ["header.topbar", ".float-layer", ".back-top"],

    async go(url, push = true) {
        try {
            const html = await fetch(url).then((r) => {
                if (!r.ok) throw new Error("http " + r.status);
                return r.text();
            });
            const doc = new DOMParser().parseFromString(html, "text/html");

            /* 当前页面要保留的元素：顶栏（含播放器）、漂浮层、返回顶部、脚本、文件框 */
            const keep = new Set();
            this.KEEP.forEach((sel) => document.querySelectorAll(sel).forEach((el) => keep.add(el)));
            document.querySelectorAll("script, input[type=file]").forEach((el) => keep.add(el));
            [...document.body.children].forEach((el) => { if (!keep.has(el)) el.remove(); });

            /* 新页面内容：跳过它自己的顶栏/漂浮层/脚本/文件框 */
            const skip = new Set();
            this.KEEP.forEach((sel) => doc.querySelectorAll(sel).forEach((el) => skip.add(el)));
            doc.querySelectorAll("script, input[type=file]").forEach((el) => skip.add(el));
            [...doc.body.children].forEach((el) => {
                if (!skip.has(el)) document.body.appendChild(document.importNode(el, true));
            });

            document.body.dataset.page = doc.body.dataset.page || "";
            document.title = doc.title;
            if (push) history.pushState(null, "", url);
            window.scrollTo(0, 0);
            App.initPage();
        } catch {
            location.href = url; // 失败降级为正常跳转
        }
    },
};

document.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const href = a.getAttribute("href") || "";
    if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    if (!/\.html($|[#?])/.test(href)) return;
    e.preventDefault();
    PJAX.go(href);
});

window.addEventListener("popstate", () => {
    PJAX.go(location.pathname.split("/").pop() + location.search, false);
});
