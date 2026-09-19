/* ============================================================
   QQ空间仿真风格 · 交互脚本
   ============================================================ */

/* ---------- Giscus 留言板配置 ----------
   部署后操作：
   1. 在 GitHub 仓库设置里开启 Discussions
   2. 安装 giscus App: https://github.com/apps/giscus
   3. 打开 https://giscus.app/zh-CN 填写仓库信息，拿到 repoId 和 categoryId
   4. 填入下面两项，留言板即自动启用                                    */
const GISCUS_CONFIG = {
    repo: "SmarietVan/SmarietVan.github.io",
    repoId: "",          // ← 填 giscus.app 生成的 data-repo-id
    category: "General",
    categoryId: "",      // ← 填 giscus.app 生成的 data-category-id
};

/* ---------- 皮肤切换（装扮） ---------- */
(function initTheme() {
    const saved = localStorage.getItem("qqzone-skin");
    if (saved) document.documentElement.dataset.theme = saved;

    const btn = document.getElementById("dressBtn");
    const panel = document.getElementById("skinPanel");

    btn.addEventListener("click", (e) => {
        if (e.target.closest(".skin-option")) return;
        panel.classList.toggle("hidden");
    });

    panel.querySelectorAll(".skin-option").forEach((opt) => {
        opt.addEventListener("click", () => {
            document.documentElement.dataset.theme = opt.dataset.skin;
            localStorage.setItem("qqzone-skin", opt.dataset.skin);
            panel.classList.add("hidden");
        });
    });

    document.addEventListener("click", (e) => {
        if (!e.target.closest(".dress")) panel.classList.add("hidden");
    });
})();

/* ---------- 顶栏导航高亮 ---------- */
(function initNav() {
    const items = document.querySelectorAll(".topnav-item:not(.dress)");
    items.forEach((item) => {
        item.addEventListener("click", () => {
            items.forEach((i) => i.classList.remove("active"));
            item.classList.add("active");
        });
    });
})();

/* ---------- 返回顶部 ---------- */
(function initBackTop() {
    const btn = document.getElementById("backTop");
    window.addEventListener("scroll", () => {
        btn.classList.toggle("hidden", window.scrollY < 400);
    });
    btn.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });
})();

/* ---------- 鼠标跟随星星（触屏设备跳过） ---------- */
(function initTrail() {
    if (matchMedia("(hover: none)").matches) return;
    const CHARS = ["✦", "✧", "★", "♪"];
    let last = 0;

    document.addEventListener("mousemove", (e) => {
        const now = Date.now();
        if (now - last < 70) return;
        last = now;

        const el = document.createElement("span");
        el.className = "trail";
        el.textContent = CHARS[Math.floor(Math.random() * CHARS.length)];
        el.style.left = e.clientX + (Math.random() * 12 - 6) + "px";
        el.style.top = e.clientY + (Math.random() * 12 - 6) + "px";
        document.body.appendChild(el);
        el.addEventListener("animationend", () => el.remove());
    });
})();

/* ---------- Giscus 留言板加载 ---------- */
(function initGiscus() {
    const container = document.getElementById("giscus-container");
    if (!container) return;
    if (!GISCUS_CONFIG.repoId || !GISCUS_CONFIG.categoryId) return;

    const script = document.createElement("script");
    script.src = "https://giscus.app/client.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.repo = GISCUS_CONFIG.repo;
    script.dataset.repoId = GISCUS_CONFIG.repoId;
    script.dataset.category = GISCUS_CONFIG.category;
    script.dataset.categoryId = GISCUS_CONFIG.categoryId;
    script.dataset.mapping = "pathname";
    script.dataset.strict = "0";
    script.dataset.reactionsEnabled = "1";
    script.dataset.emitMetadata = "0";
    script.dataset.inputPosition = "top";
    script.dataset.theme = "preferred_color_scheme";
    script.dataset.lang = "zh-CN";

    container.innerHTML = "";
    container.appendChild(script);
})();
