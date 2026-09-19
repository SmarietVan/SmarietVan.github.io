/* ============================================================
   数据层：localStorage
   ------------------------------------------------------------
   已发表的公开日志 → 托管在 GitHub 仓库 posts/*.md（见 app.js）
   本地只存：
     posts:    草稿 + 私密日记 [{ id, title, content, cate, priv, draft, deleted, time }]
     meta:     每篇日志的浏览/点赞/评论 { [postId]: { views, likes, comments[] } }
               （仓库日志以文件名做 postId，本地日志以本地 id）
     albums:   相册 [{ id, name, lock, deleted, photos[] }]
     msgs:     本地留言 [{ id, name, text, time }]
     settings: { greeting }
   ============================================================ */
const Store = (function () {
    const KEY = "qqzone-data-v2";

    function seed() {
        return {
            posts: [],
            meta: {
                "2025-01-01-welcome": {
                    views: 1024, likes: 0,
                    comments: [{ name: "热心访客", text: "前排沙发！空间装扮得不错～", time: "2025-01-01 13:20" }],
                },
                "2025-01-02-post-2": { views: 512, likes: 0, comments: [] },
                "2025-01-03-post-3": { views: 256, likes: 0, comments: [] },
            },
            cates: ["个人日记", "技术"],
            albums: [
                { id: "a1", name: "项目一", lock: true, deleted: false, photos: [] },
                { id: "a2", name: "项目二", lock: false, deleted: false, photos: [] },
                { id: "a3", name: "项目三", lock: false, deleted: false, photos: [] },
                { id: "a4", name: "说说和日志相册", lock: true, deleted: false, photos: [] },
            ],
            msgs: [
                { id: "m1", name: "热心访客", text: "踩踩～空间不错，记得回踩哦！", time: "2025-01-05 20:00" },
            ],
            settings: { greeting: "欢迎光临我的小窝～来都来了，留个言再走吧，禁止跑堂！🙂" },
        };
    }

    function load() {
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* 数据损坏则重置 */ }
        const data = seed();
        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
        return data;
    }

    let data = load();

    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify(data));
            return true;
        } catch (e) {
            return false; // 超出 localStorage 配额
        }
    }

    function uid(prefix) {
        return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function now() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    return {
        get data() { return data; },
        save, uid, now,

        /* ---- 本地日志（草稿 / 私密） ---- */
        addPost(p) {
            const post = Object.assign({
                id: uid("p"), priv: false, draft: false, deleted: false,
                time: now(),
            }, p);
            data.posts.unshift(post);
            save();
            return post;
        },
        getPost(id) { return data.posts.find((p) => p.id === id); },
        updatePost(id, patch) {
            const p = this.getPost(id);
            if (p) { Object.assign(p, patch); save(); }
            return p;
        },
        removePost(id) {
            data.posts = data.posts.filter((p) => p.id !== id);
            save();
        },
        addCate(name) {
            if (name && !data.cates.includes(name)) { data.cates.push(name); save(); }
        },

        /* ---- 日志元数据（浏览/点赞/评论，仓库日志通用） ---- */
        getMeta(id) {
            if (!data.meta[id]) data.meta[id] = { views: 0, likes: 0, comments: [] };
            return data.meta[id];
        },
        saveMeta() { save(); },
        addComment(postId, name, text) {
            this.getMeta(postId).comments.push({ name, text, time: now() });
            save();
        },

        /* ---- 相册 ---- */
        addAlbum(name, lock) {
            const a = { id: uid("a"), name, lock: !!lock, deleted: false, photos: [] };
            data.albums.push(a);
            save();
            return a;
        },
        getAlbum(id) { return data.albums.find((a) => a.id === id); },
        updateAlbum(id, patch) {
            const a = this.getAlbum(id);
            if (a) { Object.assign(a, patch); save(); }
            return a;
        },
        addPhoto(albumId, name, src) {
            const a = this.getAlbum(albumId);
            if (!a) return false;
            a.photos.push({ id: uid("ph"), name, src });
            const ok = save();
            if (!ok) a.photos.pop(); // 存不下就回滚
            return ok;
        },
        delPhoto(albumId, photoId) {
            const a = this.getAlbum(albumId);
            if (!a) return;
            a.photos = a.photos.filter((p) => p.id !== photoId);
            save();
        },

        /* ---- 留言 ---- */
        addMsg(name, text) {
            data.msgs.unshift({ id: uid("m"), name, text, time: now() });
            save();
        },
    };
})();
