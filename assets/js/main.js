/* =========================================================
   C++ & 算法 学习路线图  ·  交互脚本
   无外部依赖，纯原生 JS
   ========================================================= */
(function () {
  "use strict";

  /* ---------- 1. C++ 代码高亮 ---------- */
  var KEYWORDS = ("alignas alignof and auto bool break case catch char char8_t char16_t char32_t class " +
    "concept const consteval constexpr constinit const_cast continue co_await co_return co_yield " +
    "decltype default delete do double dynamic_cast else enum explicit export extern false float for " +
    "friend goto if inline int long mutable namespace new noexcept not nullptr operator or private " +
    "protected public register reinterpret_cast requires return short signed sizeof static static_assert " +
    "static_cast struct switch template this thread_local throw true try typedef typeid typename union " +
    "unsigned using virtual void volatile wchar_t while xor override final import module").split(" ");

  var TYPES = ("std string vector map set unordered_map unordered_set pair tuple array list deque queue " +
    "priority_queue stack bitset string_view optional variant function shared_ptr unique_ptr weak_ptr " +
    "size_t int64_t uint64_t int32_t uint32_t ostream istream ifstream ofstream stringstream " +
    "iterator const_iterator chrono thread mutex atomic").split(" ");

  var KW = Object.create(null), TY = Object.create(null);
  KEYWORDS.forEach(function (k) { KW[k] = 1; });
  TYPES.forEach(function (k) { TY[k] = 1; });

  // 用私有区字符保护已转义的实体，避免高亮器破坏它们
  var SENT = { "&lt;": "\uE000", "&gt;": "\uE001", "&amp;": "\uE002", "&quot;": "\uE003", "&#39;": "\uE004" };
  var BACK = { "\uE000": "&lt;", "\uE001": "&gt;", "\uE002": "&amp;", "\uE003": "&quot;", "\uE004": "&#39;" };

  function protect(s) {
    return s.replace(/&(lt|gt|amp|quot|#39);/g, function (m) { return SENT[m] || m; });
  }
  function restore(s) {
    return s.replace(/[\uE000-\uE004]/g, function (m) { return BACK[m] || m; });
  }

  var TOKEN_RE = new RegExp(
    "(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)" +      // 1 注释
    "|(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*')" + // 2 字符串/字符
    "|(\\b\\d+\\.?\\d*(?:[eE][+-]?\\d+)?[fFuUlL]*\\b)" +  // 3 数字
    "|([A-Za-z_]\\w*)",                                  // 4 标识符
    "g"
  );

  function highlight(src) {
    var code = protect(src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    var out = code.replace(TOKEN_RE, function (m, cmt, str, num, word) {
      if (cmt) return '<span class="tok-cmt">' + cmt + "</span>";
      if (str) return '<span class="tok-str">' + str + "</span>";
      if (num) return '<span class="tok-num">' + num + "</span>";
      if (word) {
        if (KW[word]) return '<span class="tok-kw">' + word + "</span>";
        if (TY[word] || /^[A-Z]/.test(word)) return '<span class="tok-type">' + word + "</span>";
        return word;
      }
      return m;
    });
    return restore(out);
  }

  // 非 C++ 语言：只做转义（可选把 # 开头的整行标为注释），不做 C++ 分词
  var CPP_LANGS = { cpp: 1, "c++": 1, c: 1, cc: 1, cxx: 1, h: 1, hpp: 1 };
  var HASH_LANGS = { bash: 1, sh: 1, shell: 1, cmake: 1, make: 1, makefile: 1, yaml: 1, yml: 1, py: 1, python: 1 };
  var SLASH_LANGS = { json: 1, jsonc: 1, js: 1, javascript: 1, ts: 1, typescript: 1 };

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlightPlain(src, hashComments) {
    var code = escapeHtml(src);
    if (hashComments) {
      code = code.replace(/^([ \t]*#[^\n]*)/gm, '<span class="tok-cmt">$1</span>');
    }
    return code;
  }

  // JSON / JS：字符串与 // 行注释。字符串状态机保证 "http://" 里的 // 不被误判。
  function highlightSlash(src) {
    var out = "";
    var i = 0;
    while (i < src.length) {
      var ch = src[i];
      if (ch === '"') {
        var j = i + 1;
        var buf = '"';
        while (j < src.length) {
          if (src[j] === "\\") { buf += src.slice(j, j + 2); j += 2; continue; }
          buf += src[j];
          j++;
          if (src[j - 1] === '"') break;
        }
        var k = j;
        while (k < src.length && (src[k] === " " || src[k] === "\t")) k++;
        out += '<span class="' + (src[k] === ":" ? "tok-type" : "tok-str") + '">' +
               escapeHtml(buf) + "</span>";
        i = j;
        continue;
      }
      if (ch === "/" && src[i + 1] === "/") {
        var e = src.indexOf("\n", i);
        if (e < 0) e = src.length;
        out += '<span class="tok-cmt">' + escapeHtml(src.slice(i, e)) + "</span>";
        i = e;
        continue;
      }
      out += escapeHtml(ch);
      i++;
    }
    return out;
  }

  // 去掉整体缩进
  function dedent(text) {
    var lines = text.replace(/\r\n?/g, "\n").split("\n");
    while (lines.length && lines[0].trim() === "") lines.shift();
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    var min = Infinity;
    lines.forEach(function (l) {
      if (!l.trim()) return;
      var n = l.match(/^[ \t]*/)[0].length;
      if (n < min) min = n;
    });
    if (!isFinite(min) || min === 0) return lines.join("\n");
    return lines.map(function (l) { return l.slice(min); }).join("\n");
  }

  function decorateCodeBlocks() {
    var blocks = document.querySelectorAll("pre.code");
    Array.prototype.forEach.call(blocks, function (pre) {
      var codeEl = pre.querySelector("code");
      if (!codeEl) return;

      var lang = (pre.getAttribute("data-lang") || "cpp").toLowerCase();
      var raw = dedent(codeEl.textContent);
      codeEl.innerHTML = CPP_LANGS[lang]
        ? highlight(raw)
        : (SLASH_LANGS[lang] ? highlightSlash(raw) : highlightPlain(raw, !!HASH_LANGS[lang]));
      codeEl.setAttribute("data-raw", raw);

      if (pre.parentElement && pre.parentElement.classList.contains("code-wrap")) return;

      var wrap = document.createElement("div");
      wrap.className = "code-wrap";
      var bar = document.createElement("div");
      bar.className = "code-bar";
      bar.innerHTML =
        '<span class="code-dots"><i></i><i></i><i></i></span>' +
        '<span class="code-lang">' + lang + "</span>" +
        '<button class="copy-btn" type="button">复制</button>';

      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(bar);
      wrap.appendChild(pre);

      bar.querySelector(".copy-btn").addEventListener("click", function () {
        var btn = this;
        var txt = codeEl.getAttribute("data-raw") || codeEl.textContent;
        var done = function () {
          btn.textContent = "已复制 ✓";
          btn.classList.add("done");
          setTimeout(function () { btn.textContent = "复制"; btn.classList.remove("done"); }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done, function () { fallback(txt, done); });
        } else {
          fallback(txt, done);
        }
      });
    });
  }

  function fallback(text, cb) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); cb(); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  /* ---------- 2. 主题切换 ---------- */
  var THEME_KEY = "cppq-theme";
  var ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
  var ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    var label = t === "dark" ? "切换到浅色主题" : "切换到深色主题";
    var btn = document.getElementById("themeBtn");
    if (btn) {
      btn.innerHTML = t === "dark" ? ICON_SUN : ICON_MOON;
      btn.setAttribute("aria-label", label);
    }
    // 封面右上角的主题按钮只显示图标，不显示文字标签
    var cbtn = document.getElementById("coverThemeBtn");
    if (cbtn) {
      cbtn.innerHTML = t === "dark" ? ICON_SUN : ICON_MOON;
      cbtn.setAttribute("aria-label", label);
      cbtn.setAttribute("title", label);
    }
  }
  function initTheme() {
    // 深色是本站默认外观；只有用户点过切换按钮才读取保存值
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
    if (saved !== "dark" && saved !== "light") saved = "dark";
    applyTheme(saved);
    function toggle() {
      var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    }
    var btn = document.getElementById("themeBtn");
    if (btn) btn.addEventListener("click", toggle);
    var cbtn = document.getElementById("coverThemeBtn");
    if (cbtn) cbtn.addEventListener("click", toggle);
  }

  /* ---------- 3. 移动端导航 ---------- */
  function initNav() {
    var toggle = document.getElementById("navToggle");
    var nav = document.getElementById("nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", function () { nav.classList.toggle("open"); });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") nav.classList.remove("open");
    });

    // 高亮当前页
    var here = location.pathname.split("/").pop() || "index.html";
    Array.prototype.forEach.call(nav.querySelectorAll("a"), function (a) {
      var href = a.getAttribute("href");
      if (!href || href.charAt(0) === "#") return;
      if (href === here) a.classList.add("active");
    });
  }

  /* ---------- 4. 阅读进度条 & 返回顶部 ---------- */
  function initScrollUi() {
    var bar = document.createElement("div");
    bar.className = "read-bar";
    document.body.appendChild(bar);

    var top = document.createElement("button");
    top.className = "to-top";
    top.type = "button";
    top.setAttribute("aria-label", "返回顶部");
    top.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    top.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });
    document.body.appendChild(top);

    var ticking = false;
    function update() {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      var p = h > 0 ? Math.min(1, window.scrollY / h) : 0;
      bar.style.width = (p * 100).toFixed(2) + "%";
      top.classList.toggle("show", window.scrollY > 640);
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* ---------- 5. 学习进度（localStorage） ---------- */
  var PROG_KEY = "cppq-progress";
  function readProgress() {
    try { return JSON.parse(localStorage.getItem(PROG_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function writeProgress(o) {
    try { localStorage.setItem(PROG_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ }
  }
  function initProgress() {
    var boxes = document.querySelectorAll(".checklist input[type=checkbox]");
    if (!boxes.length) return;
    var store = readProgress();

    var box = document.querySelector("[data-progress-box]");
    var fill = box ? box.querySelector(".progress-fill") : null;
    var num = box ? box.querySelector(".progress-num") : null;

    function refresh() {
      var total = boxes.length, done = 0;
      Array.prototype.forEach.call(boxes, function (c) { if (c.checked) done++; });
      var pct = total ? Math.round((done / total) * 100) : 0;
      if (fill) fill.style.width = pct + "%";
      if (num) num.textContent = done + " / " + total + " (" + pct + "%)";
    }

    Array.prototype.forEach.call(boxes, function (c) {
      var id = c.getAttribute("data-id") || c.id;
      if (store[id]) c.checked = true;
      c.addEventListener("change", function () {
        var s = readProgress();
        if (c.checked) s[id] = 1; else delete s[id];
        writeProgress(s);
        refresh();
      });
    });

    var reset = box ? box.querySelector(".reset-btn") : null;
    if (reset) {
      reset.addEventListener("click", function () {
        Array.prototype.forEach.call(boxes, function (c) { c.checked = false; });
        writeProgress({});
        refresh();
      });
    }
    refresh();
  }

  /* ---------- 7. 起始页封面：本地背景图 + 下拉翻页 ---------- */
  var COVER_BG_KEY = "cppq-cover-bg";

  function initCover() {
    var cover = document.getElementById("cover");
    if (!cover) return;
    var bg = document.getElementById("coverBg");
    var driver = document.getElementById("coverDriver");
    var pageBody = document.getElementById("pageBody");
    var note = document.getElementById("coverNote");
    var clearBtn = document.getElementById("coverClearBtn");
    var uploadBtn = document.getElementById("coverUploadBtn");
    var fileInput = document.getElementById("coverFile");
    var root = document.documentElement;
    var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    /* ---- 7.1 提示 ---- */
    var noteTimer = null;
    function say(msg) {
      if (!note) return;
      note.textContent = msg || "";
      note.classList.toggle("show", !!msg);
      if (noteTimer) clearTimeout(noteTimer);
      if (msg) noteTimer = setTimeout(function () { note.classList.remove("show"); }, 3600);
    }

    /* ---- 7.2 背景图：读取 / 保存 / 清除 ---- */
    function paint(url) {
      if (url) {
        bg.style.backgroundImage = 'url("' + url + '")';
        cover.classList.add("has-bg");
        if (clearBtn) clearBtn.hidden = false;
      } else {
        bg.style.backgroundImage = "";
        cover.classList.remove("has-bg");
        if (clearBtn) clearBtn.hidden = true;
      }
    }
    function save(url) {
      try { localStorage.setItem(COVER_BG_KEY, url); return true; }
      catch (e) { return false; }
    }
    function load() {
      try { return localStorage.getItem(COVER_BG_KEY) || ""; }
      catch (e) { return ""; }
    }

    /* 把图片压到能塞进 localStorage 的大小；成功回调 dataURL，失败回调 null */
    function shrinkToFit(file, done) {
      var reader = new FileReader();
      reader.onerror = function () { done(null); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { done(null); };
        img.onload = function () {
          var tries = [[1920, 0.82], [1440, 0.72], [1080, 0.62], [760, 0.52]];
          var i = 0;
          (function next() {
            if (i >= tries.length) { done(null); return; }
            var maxSide = tries[i][0], q = tries[i][1];
            i++;
            var k = Math.min(1, maxSide / Math.max(img.width, img.height));
            var w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
            var cv = document.createElement("canvas");
            cv.width = w; cv.height = h;
            var ctx = cv.getContext("2d");
            if (!ctx) { done(null); return; }
            ctx.drawImage(img, 0, 0, w, h);
            var url = null;
            try { url = cv.toDataURL("image/jpeg", q); } catch (e) { url = null; }
            if (!url) { done(null); return; }
            if (save(url)) done(url); else next();
          })();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }

    function handleFile(file) {
      if (!file) return;
      if (!/^image\//.test(file.type)) { say("请选择图片文件"); return; }
      say("正在处理…");
      var reader = new FileReader();
      reader.onerror = function () { say("图片读取失败"); };
      reader.onload = function () {
        var url = String(reader.result || "");
        // 小图（含 png / gif / webp）优先原样保存，保留透明与动画
        if (file.size <= 1200 * 1024 && save(url)) { paint(url); say("已设为起始页背景"); return; }
        shrinkToFit(file, function (small) {
          if (small) { paint(small); say("已压缩后设为背景"); return; }
          // 存不进浏览器缓存：本次会话仍然生效
          paint(url);
          say("已设为背景（没能存进浏览器缓存，下次打开需重新上传）");
        });
      };
      reader.readAsDataURL(file);
    }

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener("click", function () { fileInput.click(); });
      fileInput.addEventListener("change", function () {
        if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
        fileInput.value = "";
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        try { localStorage.removeItem(COVER_BG_KEY); } catch (e) { /* ignore */ }
        paint("");
        say("已移除背景");
      });
    }
    paint(load());

    /* ---- 7.3 翻页：一次手势就整页翻过去 ---- */
    var shade = cover.querySelector(".cover-shade");
    var DRIVER_RATIO = 0.38;                        // 封面占用的滚动距离 = 视口高度的 38%
    var DUR_IN  = reduce ? 160 : 520;               // 翻进正文
    var DUR_OUT = reduce ? 160 : 400;               // 翻回封面
    var driverH = 1, anim = null, ticking = false;
    // 两个互斥状态：
    //   cover   —— 封面占位存在，页面只能停在封面或正文两页
    //   content —— 直接把封面占位收成 0 高，正文里再怎么上下滚都不会冒出封面
    var onCover = true;
    var p = 0;                                      // 封面进度 0..1

    function nowMs() {
      return (window.performance && performance.now) ? performance.now() : Date.now();
    }
    function viewportH() { return window.innerHeight || document.documentElement.clientHeight || 800; }
    function measure() { return Math.max(1, Math.round(viewportH() * DRIVER_RATIO)); }
    function setDriver(h) { if (driver) driver.style.height = h + "px"; }
    function ease(t) {
      // 先快后慢：手势一落下马上升起，末段再稳稳停住
      var u = 1 - t;
      return 1 - u * u * u * (1 + 0.35 * t);
    }
    function setScroll(v) {
      // 必须显式 auto：CSS 里的 scroll-behavior: smooth 会让逐帧滚动变得拖沓
      window.scrollTo({ top: v, left: 0, behavior: "auto" });
    }
    // 渲染：v = 0 封面完全盖住屏幕 → v = 1 正文完全就位
    function render(v) {
      if (v < 0) v = 0; else if (v > 1) v = 1;
      p = v;
      var front = 1 - Math.max(0, Math.min(1, (v - 0.5) / 0.5));   // 封面淡出
      if (reduce) {
        cover.style.transform = "";
        cover.style.opacity = front.toFixed(3);
      } else {
        cover.style.transform =
          "perspective(1500px) translateZ(" + (-40 * v).toFixed(1) + "px)" +
          " rotateX(" + (v * 96).toFixed(2) + "deg)";
        cover.style.opacity = front.toFixed(3);
        if (shade) shade.style.opacity = (1 - 0.45 * v).toFixed(3);  // 掀起时压暗，出景深
      }
      cover.style.visibility = v > 0.999 ? "hidden" : "";
      cover.style.pointerEvents = v > 0.55 ? "none" : "";

      var q = Math.max(0, Math.min(1, (v - 0.16) / 0.84));
      var e = q * q * (3 - 2 * q);                                 // smoothstep，衔接更柔和
      pageBody.style.opacity = e.toFixed(3);
      pageBody.style.transform = reduce ? "" : "translateY(" + ((1 - e) * 18).toFixed(1) + "px)";

      root.classList.toggle("cover-up", v < 0.6);
    }
    // 进入正文：把封面占位收成 0 高，于是正文里无论怎么上下滚都不会再冒出封面
    function collapse() {
      onCover = false;
      setDriver(0);
      setScroll(Math.max(0, window.scrollY - driverH));
      render(1);
    }
    // 把封面占位加回来，并把滚动位置换成"占位后的坐标系"（画面完全不动）
    function restoreDriver() {
      if (onCover) return;
      onCover = true;
      gestureAtTop = false;
      setDriver(driverH);
      setScroll(window.scrollY + driverH);
    }
    function stopAnim() {
      if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
    }
    // 平滑地把整页翻到 target（0 = 封面，1 = 正文）
    function goTo(target, dur) {
      var to = target ? 1 : 0;
      if (anim && anim.to === to) return;   // 惯性滚轮连续触发时不要反复打断自己
      stopAnim();
      if (to === 0 && !onCover) {
        busy = true;
        restoreDriver();                    // 占位回来了，画面还停在正文
        setScroll(driverH);                 // 正文回到顶部，正好铺满翻页动画的起点
        render(1);
        // 浏览器是异步派发 scroll 的，这次自己造成的滚动不要被当成"用户滚过头了"
        ignoreScrollUntil = nowMs() + 200;
        busy = false;
      }
      var from = p;
      if (to === 1 && !onCover) { render(1); return; }
      if (from === to) { setScroll(to * driverH); render(to); return; }
      var t0 = nowMs();
      var job = { raf: 0, to: to };
      anim = job;
      function step(now) {
        if (anim !== job) return;           // 已经被新的翻页接管，旧循环立刻退出
        var t = dur > 0 ? Math.min(1, (now - t0) / dur) : 1;
        var v = from + (to - from) * ease(t);
        setScroll(v * driverH);
        render(v);
        if (t < 1) { job.raf = requestAnimationFrame(step); }
        else {
          anim = null;
          if (to === 1) {
            collapse();                     // 翻完就收掉占位，避免"封面又翻一次"
            // 惯性尾巴：整段吃完，直到用户停手或重新落手
            tailActive = true; tailUntil = nowMs() + TAIL_MAX;
          } else {
            setScroll(0);                   // 占位已加回，滚到 0 封面正好铺满
            render(0);
          }
        }
      }
      job.raf = requestAnimationFrame(step);
    }
    function coverShowing() { return onCover && p < 0.999; }

    /* 初始化：浏览器刷新后可能已经带着滚动位置进来，分别对齐两种状态 */
    driverH = measure();
    var y0 = window.scrollY || 0;
    if (y0 > 4) {
      onCover = false;
      setDriver(0);
      setScroll(Math.max(0, y0 - driverH));
      render(1);
    } else {
      onCover = true;
      setDriver(driverH);
      setScroll(Math.min(y0, driverH));
      render(Math.min(1, y0 / driverH));
    }
    var busy = false;                           // 状态切换中，忽略自己触发的 scroll

    /* 滚轮 / 触控板：一有向下的手势就整页翻过去，不再需要慢慢滚满一屏 */
    var GESTURE_GAP = 250;                      // 两个事件间隔超过它就算"重新落手"
    var TAIL_MAX = 3000;                        // 惯性尾巴最长吃掉 3 秒，保底不卡住用户
    var lastWheelAt = -1e9;
    var tailActive = false, tailUntil = 0;      // 翻页后的惯性尾巴
    var ignoreScrollUntil = 0;                  // 自己造成的滚动，别当成用户操作
    var gestureAtTop = false;                   // 这次手势是从正文最顶上开始的吗
    window.addEventListener("wheel", function (e) {
      if (e.ctrlKey) return;                                  // 触控板双指缩放 / 浏览器缩放
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;    // 横向手势
      var d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;
      else if (e.deltaMode === 2) d *= viewportH();
      if (!d || Math.abs(d) < 1) return;
      var dir = d > 0 ? 1 : -1;
      var now = nowMs();
      var newGesture = (now - lastWheelAt) >= GESTURE_GAP;
      lastWheelAt = now;
      if (newGesture) gestureAtTop = (window.scrollY <= 1);

      // 一次手势只翻一次：翻完之后整段惯性尾巴（可能长达一两秒）全部吃掉
      if (tailActive) {
        if (now > tailUntil || newGesture) tailActive = false;
        else { e.preventDefault(); return; }
      }
      if (!onCover) {
        // 正文里正常滚动。回起始页只认"本来就站在正文最顶上"的那一次新手势：
        // 从正文中间一路往上冲过头（含惯性残余）只会停在顶部，不会突然把封面拽出来。
        if (dir < 0 && window.scrollY <= 1 && gestureAtTop) { e.preventDefault(); goTo(0, DUR_OUT); }
        return;
      }
      if (anim && !newGesture) { e.preventDefault(); return; } // 正在翻页时，同一次手势不许来回折返
      e.preventDefault();
      goTo(dir > 0 ? 1 : 0, dir > 0 ? DUR_IN : DUR_OUT);
    }, { passive: false });

    /* 触屏：滑动超过 8px 就翻页 */
    var touchY = null, touchDone = false;
    window.addEventListener("touchstart", function (e) {
      if (!e.touches || e.touches.length !== 1) { touchY = null; return; }
      touchY = e.touches[0].clientY;
      touchDone = false;
    }, { passive: true });
    window.addEventListener("touchmove", function (e) {
      if (touchY === null || touchDone) return;
      var dy = touchY - e.touches[0].clientY;
      if (Math.abs(dy) < 8) return;
      if (!onCover) {
        if (dy < 0 && window.scrollY <= 1) {          // 在正文最顶上继续往下拽 = 回起始页
          if (e.cancelable) e.preventDefault();
          touchDone = true;
          goTo(0, DUR_OUT);
        }
        return;
      }
      if (e.cancelable) e.preventDefault();
      touchDone = true;
      goTo(dy > 0 ? 1 : 0, dy > 0 ? DUR_IN : DUR_OUT);
    }, { passive: false });
    window.addEventListener("touchend", function () { touchY = null; touchDone = false; }, { passive: true });

    /* 键盘 */
    window.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A") return;
      var k = e.key;
      if (k === " " || k === "Spacebar" || k === "ArrowDown" || k === "PageDown" || k === "Enter") {
        if (onCover && window.scrollY < driverH - 1) { e.preventDefault(); goTo(1, DUR_IN); }
        return;
      }
      if (k === "ArrowUp" || k === "PageUp") {
        if (!onCover) {
          if (window.scrollY <= 1) { e.preventDefault(); goTo(0, DUR_OUT); }
          return;
        }
        if (window.scrollY > 0 && window.scrollY <= driverH + 1) { e.preventDefault(); goTo(0, DUR_OUT); }
      }
    });

    /* 页内锚点（比如首页的"看完整路线"）：先把封面占位收掉，再滚到目标 */
    document.addEventListener("click", function (e) {
      var t = e.target;
      var a = (t && t.closest) ? t.closest('a[href^="#"]') : null;
      if (!a) return;
      var id = (a.getAttribute("href") || "").slice(1);
      var el = id ? document.getElementById(id) : null;
      if (!el) return;
      e.preventDefault();
      if (onCover) { busy = true; collapse(); busy = false; }
      var y = el.getBoundingClientRect().top + (window.scrollY || 0) - 84;
      window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
      if (history.replaceState) history.replaceState(null, "", "#" + id);
    });

    /* 封面模式下的滚动位置同步（拖滚动条、锚点跳转、刷新恢复） */
    var snapTimer = null;
    window.addEventListener("scroll", function () {
      if (busy || anim || nowMs() < ignoreScrollUntil) return;
      if (!onCover) return;                     // 正文里不再由滚动位置驱动封面
      if (window.scrollY >= driverH - 1) { busy = true; collapse(); busy = false; return; }
      if (snapTimer) clearTimeout(snapTimer);
      // 拖滚动条时也别停在半页：松手后自动吸附到最近的一侧
      snapTimer = setTimeout(function () {
        if (anim || busy || !onCover) return;
        var v = Math.min(1, window.scrollY / driverH);
        if (v > 0.02 && v < 0.98) goTo(v < 0.5 ? 0 : 1, v < 0.5 ? DUR_OUT : DUR_IN);
      }, 180);
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        if (busy || anim || !onCover) return;
        render(Math.min(1, window.scrollY / driverH));
      });
    }, { passive: true });
    window.addEventListener("resize", function () {
      stopAnim();
      driverH = measure();
      if (onCover) {
        setDriver(driverH);
        setScroll(p * driverH);
        render(p);
      } else {
        setDriver(0);
        render(1);
      }
    });
  }

  /* ---------- 8. 启动 ---------- */
  function boot() {
    initTheme();
    initNav();
    decorateCodeBlocks();
    initScrollUi();
    initProgress();
    initCover();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
