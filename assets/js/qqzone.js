/* ============================================================
   QQ空间仿真风格 · 交互脚本
   ============================================================ */

/* ---------- Giscus 留言板已移除 ---------- */

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

/* ---------- 手机汉堡菜单 ---------- */
(function initMobileNav() {
    const inner = document.querySelector(".topbar-inner");
    if (!inner) return;

    const btn = document.createElement("button");
    btn.className = "nav-toggle";
    btn.textContent = "☰";
    btn.setAttribute("aria-label", "菜单");
    inner.insertBefore(btn, inner.firstChild);

    const menu = document.createElement("div");
    menu.className = "mobile-menu hidden";
    menu.innerHTML = `
        <a href="index.html">🏠 我的主页</a>
        <a href="blog.html">📝 日志</a>
        <a href="album.html">📷 相册</a>
        <a href="music.html">🎵 音乐盒</a>
        <div class="mm-skins">
            <span>皮肤：</span>
            <button data-skin="starry">星空蓝</button>
            <button data-skin="pink">樱花粉</button>
            <button data-skin="cool">炫酷黑</button>
            <button data-skin="green">清新绿</button>
        </div>`;
    document.body.appendChild(menu);

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.classList.toggle("hidden");
    });
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".mobile-menu") && !e.target.closest(".nav-toggle")) {
            menu.classList.add("hidden");
        }
    });
    menu.querySelectorAll("a").forEach((a) => {
        a.addEventListener("click", () => menu.classList.add("hidden"));
    });
    menu.querySelectorAll("[data-skin]").forEach((opt) => {
        opt.addEventListener("click", () => {
            document.documentElement.dataset.theme = opt.dataset.skin;
            localStorage.setItem("qqzone-skin", opt.dataset.skin);
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
