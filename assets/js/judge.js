/* =========================================================================
   CodeJudge · 在线编程 + 自动判题引擎
   -------------------------------------------------------------------------
   适用场景：纯静态 C++ 学习站点（双击 HTML 即可打开，无构建工具、无外部依赖）

   设计原则：所有判题都在「真实在线编译器」上完成，本文件不含任何模拟结果。
             取不到结果时只如实报错，绝不谎报「通过」。

   -------------------------------------------------------------------------
   一、挂载约定（页面作者只需写一个空容器 + 一个 data-lab 属性）
   -------------------------------------------------------------------------
   注意：data-lab 外层用【单引号】包裹，内部 JSON 用双引号，这样引号不会互相打架。

     <div class="code-lab" data-lab='{
       "title": "两数之和",
       "statement": "读入两个整数 a、b，输出它们的和。\n数据范围：|a|,|b| <= 10^9",
       "template": "#include <iostream>\n\nint main() {\n\n    return 0;\n}\n",
       "tests": [
         { "input": "3 4\n", "output": "7\n" },
         { "input": "-10 4\n", "output": "-6\n" }
       ],
       "hints": ["直接用 cin 读入即可", "注意负数"]
     }'></div>

   字段说明（只有 tests 是必需的）：
     title     题目标题，省略显示「编程练习」
     statement 题干说明，字符串里的 \n 会按换行显示
     template  编辑器初始代码，省略则给一段最小 C++ 骨架
     tests     [{ "input": 标准输入, "output": 期望标准输出, "name": 可选名字 }]
     hints     提示数组，可省略
     id        题目 id，省略则用标题（只用于结果缓存的归类）
     options   单题覆盖默认配置，如 { "timeoutMs": 20000, "lineNumbers": false }

   -------------------------------------------------------------------------
   一之二、两种写法都可以（优先用内嵌 JSON 脚本）
   -------------------------------------------------------------------------
   写法 A（推荐）：把 JSON 放进 .code-lab 内的 <script type="application/json" class="lab-spec">。
   好处是里面可以直接写 C++ 代码，HTML 属性不用做任何转义：

     <div class="code-lab">
       <script type="application/json" class="lab-spec">
       {
         "title": "两数之和",
         "statement": "读入两个整数 a、b，输出它们的和。",
         "template": "#include <iostream>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n",
         "tests": [{ "input": "3 4\n", "output": "7\n" }]
       }
       </script>
     </div>

   写法 B：把同一份 JSON 写在 data-lab 属性里，外层用单引号包住。

   解析优先级：先取容器内 script.lab-spec（或任意 type="application/json" 的脚本）的
   文本内容做 JSON.parse；没有再回退到 data-lab 属性。两种写法不要同时用。

   容器原有的其它内容会被判题界面替换，所以除了那段 script，请写成空容器。

   -------------------------------------------------------------------------
   二、对外接口（window.CodeJudge）
   -------------------------------------------------------------------------
     CodeJudge.run(code, stdin)        -> Promise<{ stdout, stderr, compileError }>
     CodeJudge.mount(root, options)    -> 手动挂载某个容器，返回操作句柄
     CodeJudge.mountAll(scope)         -> 挂载范围内全部容器
     CodeJudge.config                  -> 默认配置（可改：超时、引擎顺序…）
     CodeJudge.clearCache()            -> 清空结果缓存
     CodeJudge.stats()                 -> { requests, cacheHits, enginesDown }
     CodeJudge.OFFLINE_TEXT            -> 「无法连接在线编译器，请检查网络」
   ========================================================================= */
(function () {
  "use strict";

  if (window.CodeJudge && window.CodeJudge.installed) return;

  var VERSION = "1.0.0";

  /* =====================================================================
     1. 配置
     ===================================================================== */

  var DEFAULTS = {
    timeoutMs: 22000,                 // 单个测试用例的超时（毫秒）；Wandbox 编译较慢，实测单次 4~10 秒，留足余量
    engineOrder: ["wandbox", "piston"], // 主接口(Wandbox) -> 备用接口；Piston 公共 API 2026-02 起仅白名单
    useCache: true,                   // 相同题目 + 相同代码 + 相同输入，复用上次结果
    lineNumbers: true,                // 编辑器显示行号
    autoIndent: true,                 // 回车自动缩进、Tab 缩进 4 空格
    tabSpaces: 4,
    piston: {
      // 官方公开接口。运行时列表见 https://emkc.org/api/v2/piston/runtimes
      // 其中 c++ 只有 10.2.0 一个版本
      url: "https://emkc.org/api/v2/piston/execute",
      language: "c++",
      version: "10.2.0",
      fileName: "main.cpp"
    },
    wandbox: {
      // 备用接口：https://wandbox.org/api/compile.json
      url: "https://wandbox.org/api/compile.json",
      compiler: "gcc-head",          // 也可用 gcc-13.2.0 / gcc-12.3.0 等
      compilerOptions: "-std=c++17"
    }
  };

  var OFFLINE_TEXT = "无法连接在线编译器，请检查网络";
  var ENGINE_DOWN_TTL = 60000;        // 引擎被标记不可用后，60 秒内不再重试
  var CACHE_LIMIT = 240;
  var DEFAULT_TEMPLATE = [
    "#include <iostream>",
    "using namespace std;",
    "",
    "int main() {",
    "    ",
    "    return 0;",
    "}",
    ""
  ].join("\n");

  var state = {
    requests: 0,
    cacheHits: 0,
    cache: new Map(),
    enginesDown: {},        // { piston: 时间戳 }
    busy: 0                 // 正在进行的判题任务数
  };

  /* =====================================================================
     2. 小工具
     ===================================================================== */

  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function empty(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) {
        if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
      }
    }
    return target;
  }

  function now() { return Date.now(); }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // FNV-1a：够快够稳，用来给「代码 + 输入」做缓存键
  function hash(str) {
    var s = String(str), hh = 0x811c9dc5, i;
    for (i = 0; i < s.length; i++) {
      hh ^= s.charCodeAt(i);
      hh = (hh + ((hh << 1) + (hh << 4) + (hh << 7) + (hh << 8) + (hh << 24))) >>> 0;
    }
    return hh.toString(16) + "-" + s.length;
  }

  // 输出归一化：统一换行符、去掉每行行尾空白、去掉结尾多余空行
  function normalize(text) {
    var s = String(text === undefined || text === null ? "" : text);
    s = s.replace(/\r\n?/g, "\n");
    var lines = s.split("\n");
    for (var i = 0; i < lines.length; i++) lines[i] = lines[i].replace(/[ \t]+$/, "");
    s = lines.join("\n");
    return s.replace(/\n+$/, "");
  }

  function mkErr(kind, message, extra) {
    var e = new Error(message);
    e.kind = kind;
    if (extra) assign(e, extra);
    return e;
  }

  function mergeOpts() {
    var out = {};
    var args = Array.prototype.slice.call(arguments);
    assign(out, DEFAULTS);
    assign(out, { piston: assign({}, DEFAULTS.piston), wandbox: assign({}, DEFAULTS.wandbox) });
    for (var i = 0; i < args.length; i++) {
      var o = args[i];
      if (!o || typeof o !== "object") continue;
      if (o.piston) o.piston = assign({}, DEFAULTS.piston, o.piston);
      if (o.wandbox) o.wandbox = assign({}, DEFAULTS.wandbox, o.wandbox);
      assign(out, o);
    }
    return out;
  }

  function fmtMs(ms) {
    if (ms < 1000) return ms + " ms";
    return (ms / 1000).toFixed(2) + " s";
  }

  /* =====================================================================
     3. 引擎层：piston / wandbox 两个在线编译器
     ===================================================================== */

  function engineSkipped(name) {
    var t = state.enginesDown[name];
    if (!t) return false;
    if (now() - t > ENGINE_DOWN_TTL) { delete state.enginesDown[name]; return false; }
    return true;
  }

  function engineDown(name) { state.enginesDown[name] = now(); }
  function engineUp(name) { delete state.enginesDown[name]; }

  // 统一的 POST JSON。刻意用 text/plain 作为 Content-Type：
  // 它属于 CORS 简单请求，浏览器不会先发 OPTIONS 预检，
  // 两个接口都能直接接受（实测 wandbox 与 piston 均返回 Access-Control-Allow-Origin: *）。
  async function fetchJson(url, body, timeoutMs) {
    var payload = JSON.stringify(body);
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs);
    state.requests++;
    var res, text;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: payload,
        signal: ctrl ? ctrl.signal : undefined,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
      text = await res.text();
    } catch (err) {
      clearTimeout(timer);
      var name = err && err.name;
      if (name === "AbortError" || name === "TimeoutError") {
        throw mkErr("timeout", "请求超时（超过 " + Math.round(timeoutMs / 1000) + " 秒）");
      }
      throw mkErr("net", "网络请求失败：" + ((err && err.message) || String(err)));
    }
    clearTimeout(timer);

    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }

    if (!res.ok) {
      var msg = (data && (data.message || data.error)) || text || "";
      throw mkErr("http", "接口返回 HTTP " + res.status + (msg ? "：" + String(msg).slice(0, 180) : ""));
    }
    if (!data || typeof data !== "object") {
      throw mkErr("badjson", "接口返回内容无法解析（可能被网络中间层拦截）");
    }
    return data;
  }

  // ---- 备用接口：Piston v2（公共接口 2026-02 起仅白名单，通常直接失败）-----------
  async function runPiston(code, stdin, opts) {
    var cfg = opts.piston;
    var timeout = opts.timeoutMs;
    var data = await fetchJson(cfg.url, {
      language: cfg.language,
      version: cfg.version,
      files: [{ name: cfg.fileName, content: code }],
      stdin: stdin,
      compile_timeout: timeout,
      run_timeout: timeout
    }, timeout + 5000);

    if (!data.compile && !data.run) {
      // 公开接口自 2026-02-15 起改为白名单制，会返回 { message: "..." } 而没有 run/compile
      throw mkErr("engine", "Piston 不可用：" + String((data && data.message) || "返回结构异常").slice(0, 180));
    }

    var out = { engine: "Piston", engineVersion: cfg.version, stdout: "", stderr: "", compileError: "", warnings: "" };
    var comp = data.compile || {};
    var run = data.run || {};
    var compErr = (comp.stderr || "").trim();
    var compFailed = (/\berror\b/i.test(compErr) && !/^\s*warning/i.test(compErr)) ||
                     (typeof comp.code === "number" && comp.code !== 0);
    if (compFailed) {
      out.compileError = compErr || String(comp.output || "").trim() || ("编译失败（退出码 " + comp.code + "）");
      return out;
    }
    if (compErr) out.warnings = compErr;
    out.stdout = run.stdout || "";
    out.stderr = run.stderr || "";
    if (!out.stderr && run.signal) out.stderr = "程序被信号中断：" + run.signal;
    if (!out.stderr && typeof run.code === "number" && run.code !== 0) out.stderr = "程序非正常退出（退出码 " + run.code + "）";
    return out;
  }

  // ---- 主接口：Wandbox（CORS 开放，浏览器可直接 fetch）---------------------
  async function runWandbox(code, stdin, opts) {
    var cfg = opts.wandbox;
    var timeout = opts.timeoutMs;
    var data = await fetchJson(cfg.url, {
      compiler: cfg.compiler,
      code: code,
      stdin: stdin,
      "compiler-option-raw": cfg.compilerOptions || "",
      "runtime-option-raw": "",
      save: false
    }, timeout + 5000);

    var cerr = String(data.compiler_error || "").trim();
    var out = { engine: "Wandbox", engineVersion: cfg.compiler, stdout: "", stderr: "", compileError: "", warnings: "" };

    // Wandbox 偶发容器故障（OCI 报错），属于临时性问题，交给上层换引擎/重试
    if (/OCI runtime error|Resource temporarily unavailable/i.test(cerr)) {
      throw mkErr("engine", "Wandbox 执行容器暂时不可用（OCI runtime error）");
    }

    if (/error:/i.test(cerr)) {
      out.compileError = cerr;
      return out;
    }
    if (cerr) out.warnings = cerr;   // 只有警告

    out.stdout = data.program_output || "";
    out.stderr = String(data.program_error || "").trim();
    if (!out.stderr && data.signal) out.stderr = "程序被信号中断：" + data.signal;
    var st = data.status;
    if (!out.stderr && st !== undefined && st !== null && String(st) !== "0") {
      out.stderr = "程序非正常退出（状态码 " + st + "）";
    }
    return out;
  }

  var ENGINES = { piston: runPiston, wandbox: runWandbox };

  function cacheSet(key, value, opts) {
    if (opts.useCache === false) return;
    if (state.cache.size >= CACHE_LIMIT) {
      var oldest = state.cache.keys().next();
      if (!oldest.done) state.cache.delete(oldest.value);
    }
    state.cache.set(key, value);
  }

  // 编译 + 运行，按 engineOrder 依次尝试，全部失败则抛 offline
  async function execute(code, stdin, options) {
    var opts = mergeOpts(options);
    var src = String(code === undefined || code === null ? "" : code);
    var input = stdin === undefined || stdin === null ? "" : String(stdin);
    var key = (opts.cacheKey || "-") + "|" + hash(src) + "|" + hash(input);

    if (opts.useCache !== false && state.cache.has(key)) {
      state.cacheHits++;
      return assign({}, state.cache.get(key), { cached: true });
    }

    var order = (opts.engineOrder || DEFAULTS.engineOrder).slice();
    var causes = [];
    for (var i = 0; i < order.length; i++) {
      var name = order[i];
      var fn = ENGINES[name];
      if (!fn) continue;
      if (!opts.force && engineSkipped(name)) {
        causes.push(name + "：上一轮不可用，本次跳过");
        continue;
      }
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          var res = await fn(src, input, opts);
          engineUp(name);
          res.cached = false;
          cacheSet(key, res, opts);
          return res;
        } catch (e) {
          causes.push(name + "：" + ((e && e.message) || String(e)));
          // 容器类临时故障、以及偶发的响应慢（Wandbox 编译耗时波动较大）都值得再试一次；
          // 超时不把引擎标记为不可用，否则一次抖动会让整道题的后续用例全部变成「离线」。
          var retryable = e && (e.kind === "engine" || e.kind === "timeout");
          if (retryable && attempt === 0 && !engineSkipped(name)) {
            await sleep(800);
            continue;
          }
          if (e && (e.kind === "http" || e.kind === "net")) engineDown(name);
          break;
        }
      }
    }
    throw mkErr("offline", OFFLINE_TEXT, { details: causes.join("；") });
  }

  var ABNORMAL_RE = /非正常退出|被信号中断|Segmentation fault|terminate called|Runtime Error|std::(out_of_range|length_error|bad_alloc|bad_cast|logic_error|runtime_error|invalid_argument|domain_error)/i;

  function isAbnormal(stderr, opts) {
    var s = String(stderr || "");
    if (!s) return false;
    if (opts && opts.strictStderr) return true;
    return ABNORMAL_RE.test(s);
  }

  /* =====================================================================
     4. 解析 data-lab
     ===================================================================== */

  function looseParse(text) {
    try { return JSON.parse(text); } catch (e) { /* 继续尝试修复 */ }
    var fixed = text
      .replace(/[\u201c\u201d]/g, '"')   // 中文引号 -> 英文引号
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([\]}])/g, "$1")     // 去掉尾随逗号
      .replace(/^\uFEFF/, "");
    try { return JSON.parse(fixed); } catch (e2) { return null; }
  }

  // 找出这个容器的题目 JSON 来源。
  // 优先级：内嵌 script.lab-spec 的 textContent > data-lab 属性。
  function labSpecSource(root) {
    var script = root.querySelector("script.lab-spec") || root.querySelector('script[type="application/json"]');
    if (script) {
      var inline = String(script.textContent || "").trim();
      if (inline) return { text: inline, from: "内嵌 script.lab-spec" };
    }
    var raw = root.getAttribute("data-lab");
    if (raw !== null && String(raw).trim()) {
      return { text: String(raw).trim(), from: "data-lab 属性" };
    }
    return null;
  }

  function parseLab(root) {
    var src = labSpecSource(root);
    if (!src) return null;            // 两种来源都没有：这不是一个判题挂载点，原样放过
    var text = src.text;
    var data = looseParse(text);
    if (!data || typeof data !== "object" || Object.prototype.toString.call(data) === "[object Array]") {
      return {
        error: src.from + " 里的内容不是合法的 JSON 对象。常见原因：属性写法外层少了单引号、JSON 里用了单引号、多了尾随逗号、代码里的换行没写成 \\n。",
        raw: text
      };
    }

    var tests = [];
    if (Object.prototype.toString.call(data.tests) === "[object Array]") {
      for (var i = 0; i < data.tests.length; i++) {
        var t = data.tests[i];
        if (!t || typeof t !== "object") continue;
        tests.push({
          name: t.name ? String(t.name) : ("用例 " + (tests.length + 1)),
          input: t.input === undefined || t.input === null ? "" : String(t.input),
          output: t.output === undefined || t.output === null ? "" : String(t.output)
        });
      }
    }
    if (!tests.length) {
      return { error: src.from + " 里没有可用的 tests 数组，至少需要一条 {\"input\":\"…\",\"output\":\"…\"}。", raw: text };
    }

    var hints = [];
    if (Object.prototype.toString.call(data.hints) === "[object Array]") {
      for (var j = 0; j < data.hints.length; j++) {
        if (data.hints[j] !== undefined && data.hints[j] !== null) hints.push(String(data.hints[j]));
      }
    }

    var title = data.title ? String(data.title) : "编程练习";
    return {
      title: title,
      id: data.id ? String(data.id) : title,
      statement: data.statement ? String(data.statement) : "",
      template: data.template === undefined || data.template === null || data.template === "" ? DEFAULT_TEMPLATE : String(data.template),
      tests: tests,
      hints: hints,
      options: data.options && typeof data.options === "object" ? data.options : null,
      error: null,
      raw: text,
      source: src.from
    };
  }

  /* =====================================================================
     5. 界面构建
     ===================================================================== */

  function renderLabError(root, spec) {
    empty(root);
    var box = h("div", "cj-alert cj-alert-static");
    box.appendChild(h("div", "cj-alert-title", "题目配置有误，未加载判题界面"));
    box.appendChild(h("p", "cj-alert-text", spec.error));
    if (spec.raw) {
      var pre = h("pre", "cj-alert-body", spec.raw);
      box.appendChild(pre);
    }
    root.appendChild(box);
  }

  function buildUI(root, spec, opts) {
    empty(root);
    var refs = { spec: spec, options: opts };

    var head = h("div", "cj-head");
    head.appendChild(h("h3", "cj-title", spec.title));
    head.appendChild(h("span", "cj-tag", spec.tests.length + " 个测试用例"));
    head.appendChild(h("span", "cj-tag cj-tag-engine", "在线编译 · C++"));
    root.appendChild(head);

    if (spec.statement) root.appendChild(h("div", "cj-statement", spec.statement));

    if (spec.hints.length) {
      var ul = h("ul", "cj-hints");
      for (var i = 0; i < spec.hints.length; i++) ul.appendChild(h("li", "cj-hint", spec.hints[i]));
      root.appendChild(ul);
    }

    /* ---- 编辑器 ---- */
    var editorBox = h("div", "cj-editor");
    var bar = h("div", "cj-editor-bar");
    bar.appendChild(h("span", "cj-editor-label", "代码编辑器 · Tab 缩进 " + opts.tabSpaces + " 空格 · Ctrl+Enter 运行 · Ctrl+Shift+Enter 判题"));
    var barActions = h("div", "cj-editor-actions");
    var copyBtn = h("button", "cj-mini", "复制代码");
    copyBtn.type = "button";
    var resetBtn = h("button", "cj-mini", "重置为初始模板");
    resetBtn.type = "button";
    barActions.appendChild(copyBtn);
    barActions.appendChild(resetBtn);
    bar.appendChild(barActions);
    editorBox.appendChild(bar);

    var codeWrap = h("div", "cj-code");
    var gutter = null;
    if (opts.lineNumbers) {
      gutter = h("pre", "cj-gutter");
      gutter.setAttribute("aria-hidden", "true");
      codeWrap.appendChild(gutter);
    }
    var ta = document.createElement("textarea");
    ta.className = "cj-input";
    ta.setAttribute("spellcheck", "false");
    ta.setAttribute("wrap", "off");
    ta.setAttribute("autocapitalize", "off");
    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("aria-label", spec.title + " 的代码编辑器");
    ta.value = spec.template;
    codeWrap.appendChild(ta);
    editorBox.appendChild(codeWrap);
    root.appendChild(editorBox);

    /* ---- 操作区 ---- */
    var actions = h("div", "cj-actions");
    var runBtn = h("button", "cj-btn cj-btn-run", "▶ 运行");
    runBtn.type = "button";
    var submitBtn = h("button", "cj-btn cj-btn-submit", "✓ 提交判题");
    submitBtn.type = "button";
    var status = h("span", "cj-status", "准备就绪");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    actions.appendChild(runBtn);
    actions.appendChild(submitBtn);
    actions.appendChild(status);
    root.appendChild(actions);

    /* ---- 编译错误 / 网络错误提示 ---- */
    var alert = h("div", "cj-alert");
    alert.hidden = true;
    var alertTitle = h("div", "cj-alert-title");
    var alertText = h("p", "cj-alert-text");
    var alertBody = h("pre", "cj-alert-body");
    alert.appendChild(alertTitle);
    alert.appendChild(alertText);
    alert.appendChild(alertBody);
    root.appendChild(alert);

    /* ---- 结果区 ---- */
    var results = h("div", "cj-results");
    root.appendChild(results);

    refs.editor = ta;
    refs.gutter = gutter;
    refs.runBtn = runBtn;
    refs.submitBtn = submitBtn;
    refs.copyBtn = copyBtn;
    refs.resetBtn = resetBtn;
    refs.status = status;
    refs.alert = alert;
    refs.alertTitle = alertTitle;
    refs.alertText = alertText;
    refs.alertBody = alertBody;
    refs.results = results;
    refs.gutterCount = 0;
    return refs;
  }

  /* =====================================================================
     6. 编辑器行为：行号 / 自动缩进 / Tab / 快捷键
     ===================================================================== */

  function syncGutter(refs) {
    if (!refs.gutter) return;
    var count = refs.editor.value.split("\n").length;
    if (count !== refs.gutterCount) {
      var lines = new Array(count);
      for (var i = 0; i < count; i++) lines[i] = String(i + 1);
      refs.gutter.textContent = lines.join("\n");
      refs.gutterCount = count;
    }
    refs.gutter.scrollTop = refs.editor.scrollTop;
  }

  function autoGrow(refs) {
    var ta = refs.editor;
    ta.style.height = "auto";
    ta.style.height = Math.max(ta.scrollHeight, 72) + "px";
  }

  function insertText(ta, text) {
    var start = ta.selectionStart, end = ta.selectionEnd;
    var value = ta.value;
    if (typeof ta.setRangeText === "function") {
      ta.setRangeText(text, start, end, "end");
    } else {
      ta.value = value.slice(0, start) + text + value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + text.length;
    }
  }

  function indentRegion(refs, outdent) {
    var ta = refs.editor, opts = refs.options;
    var value = ta.value;
    var start = ta.selectionStart, end = ta.selectionEnd;
    var unit = new Array((opts.tabSpaces || 4) + 1).join(" ");

    // 没有跨行选择：直接插入 / 删除缩进
    if (value.slice(start, end).indexOf("\n") === -1) {
      if (!outdent) { insertText(ta, unit); return; }
      var lineStart = value.lastIndexOf("\n", start - 1) + 1;
      var head = value.slice(lineStart, start);
      var cut = 0;
      if (head.slice(-unit.length) === unit) cut = unit.length;
      else if (/^[ \t]/.test(head)) cut = 1;
      if (!cut) return;
      ta.setSelectionRange(start - cut, start);
      insertText(ta, "");
      return;
    }

    // 跨行选择：整块缩进 / 反缩进
    var blockStart = value.lastIndexOf("\n", start - 1) + 1;
    var block = value.slice(blockStart, end);
    var lines = block.split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (outdent) {
        if (lines[i].slice(0, unit.length) === unit) lines[i] = lines[i].slice(unit.length);
        else lines[i] = lines[i].replace(/^[ \t]/, "");
      } else {
        lines[i] = unit + lines[i];
      }
    }
    var next = lines.join("\n");
    ta.setSelectionRange(blockStart, end);
    insertText(ta, next);
    ta.setSelectionRange(blockStart, blockStart + next.length);
  }

  function onEditorKeydown(ev, refs) {
    var ta = refs.editor, opts = refs.options;

    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      if (ev.shiftKey) doJudge(refs); else doRun(refs);
      return;
    }

    if (ev.key === "Tab" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      if (!opts.autoIndent) return;      // 交给浏览器默认行为（移动焦点）
      ev.preventDefault();
      indentRegion(refs, ev.shiftKey);
      syncGutter(refs);
      autoGrow(refs);
      return;
    }

    if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey && !ev.altKey && opts.autoIndent) {
      var value = ta.value;
      var start = ta.selectionStart, end = ta.selectionEnd;
      var lineStart = value.lastIndexOf("\n", start - 1) + 1;
      var current = value.slice(lineStart, start);
      var margin = (current.match(/^[ \t]*/) || [""])[0];
      var before = value.slice(start - 1, start);
      var afterChar = value.slice(end, end + 1);
      var unit = new Array((opts.tabSpaces || 4) + 1).join(" ");
      var add = "";
      if (before === "{") {
        add = unit;
        if (afterChar === "}") {
          // 在 { } 之间回车：展开成三行
          ev.preventDefault();
          insertText(ta, "\n" + margin + unit + "\n" + margin);
          ta.selectionStart = ta.selectionEnd = start + 1 + margin.length + unit.length;
          syncGutter(refs);
          autoGrow(refs);
          return;
        }
      } else if (before === "}" && /^\s*$/.test(current)) {
        // 纯 } 行：反缩进一级
        if (margin.slice(-unit.length) === unit) {
          ev.preventDefault();
          ta.setSelectionRange(start - unit.length, start);
          insertText(ta, "\n" + margin.slice(0, -unit.length));
          syncGutter(refs);
          autoGrow(refs);
          return;
        }
      }
      if (add || margin) {
        ev.preventDefault();
        insertText(ta, "\n" + margin + add);
        syncGutter(refs);
        autoGrow(refs);
      }
      return;
    }
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(false); });
        return;
      }
      var tmp = document.createElement("textarea");
      tmp.value = text;
      tmp.setAttribute("readonly", "readonly");
      tmp.style.position = "fixed";
      tmp.style.left = "-9999px";
      document.body.appendChild(tmp);
      tmp.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(tmp);
      resolve(ok);
    });
  }

  /* =====================================================================
     7. 结果渲染
     ===================================================================== */

  function setStatus(refs, text, tone) {
    refs.status.textContent = text;
    refs.status.className = "cj-status" + (tone ? " is-" + tone : "");
  }

  function setBusy(refs, busy) {
    state.busy += busy ? 1 : -1;
    if (state.busy < 0) state.busy = 0;
    refs.runBtn.disabled = !!busy;
    refs.submitBtn.disabled = !!busy;
    refs.runBtn.classList.toggle("is-loading", !!busy);
  }

  function showAlert(refs, title, text, body) {
    refs.alert.hidden = false;
    refs.alertTitle.textContent = title || "";
    refs.alertText.textContent = text || "";
    refs.alertText.hidden = !text;
    refs.alertBody.textContent = body || "";
    refs.alertBody.hidden = !body;
    refs.alert.classList.toggle("is-warn", /无法连接|超时/.test(title + text));
  }

  function clearAlert(refs) {
    refs.alert.hidden = true;
    refs.alertTitle.textContent = "";
    refs.alertText.textContent = "";
    refs.alertBody.textContent = "";
  }

  function clearResults(refs) { empty(refs.results); }

  function makeCase(refs, index, test, withExpected) {
    var art = h("article", "cj-case");

    var head = h("div", "cj-case-head");
    var badge = h("span", "cj-badge", "等待中");
    var name = h("span", "cj-case-name", test.name || ("用例 " + (index + 1)));
    var meta = h("span", "cj-case-meta", "");
    head.appendChild(badge);
    head.appendChild(name);
    head.appendChild(meta);
    art.appendChild(head);

    var cols = h("div", "cj-cols");
    var colIn = h("div", "cj-col cj-in");
    colIn.appendChild(h("h4", null, "输入"));
    var preIn = h("pre", null, test.input === "" ? "（无输入）" : test.input);
    colIn.appendChild(preIn);
    cols.appendChild(colIn);

    var preOut = null, preErr = null, colOut = null, colErr = null;
    if (withExpected) {
      colOut = h("div", "cj-col cj-expect");
      colOut.appendChild(h("h4", null, "期望输出"));
      var preExp = h("pre", null, test.output === "" ? "（无输出）" : test.output);
      colOut.appendChild(preExp);
      cols.appendChild(colOut);
    }

    var colAct = h("div", "cj-col cj-actual");
    colAct.appendChild(h("h4", null, withExpected ? "实际输出" : "程序输出"));
    preOut = h("pre", null, "…");
    colAct.appendChild(preOut);
    cols.appendChild(colAct);

    colErr = h("div", "cj-col cj-stderr");
    colErr.hidden = true;
    colErr.appendChild(h("h4", null, "错误输出 (stderr)"));
    preErr = h("pre", null, "");
    colErr.appendChild(preErr);
    cols.appendChild(colErr);

    art.appendChild(cols);
    refs.results.appendChild(art);
    refs.results.classList.add("cj-results-live");

    return {
      article: art, badge: badge, meta: meta, cols: cols,
      preOut: preOut, outCol: colAct, errCol: colErr, preErr: preErr
    };
  }

  function fillCase(row, state_, info) {
    info = info || {};
    row.article.className = "cj-case is-" + state_;
    row.badge.className = "cj-badge is-" + state_;
    row.badge.textContent = info.badge || (state_ === "pass" ? "通过" : state_ === "fail" ? "未通过" : "错误");

    var metaBits = [];
    if (info.ms !== undefined) metaBits.push(fmtMs(info.ms));
    if (info.engine) metaBits.push(info.engine + (info.engineVersion ? " " + info.engineVersion : ""));
    if (info.cached) metaBits.push("缓存命中");
    row.meta.textContent = metaBits.join(" · ");

    if (info.actual !== undefined) row.preOut.textContent = info.actual === "" ? "（无输出）" : info.actual;
    if (info.expected !== undefined) row.outCol.classList.add("cj-col-compare");
    if (info.stderr) {
      row.errCol.hidden = false;
      row.preErr.textContent = info.stderr;
    } else {
      row.errCol.hidden = true;
    }
    if (info.hint) {
      var tip = h("p", "cj-case-tip", info.hint);
      row.article.appendChild(tip);
    }
  }

  /* =====================================================================
     8. 运行 / 判题
     ===================================================================== */

  function guardEditor(refs) {
    if (!refs.editor.value.trim()) {
      setStatus(refs, "代码是空的，先写点什么吧", "bad");
      refs.editor.focus();
      return false;
    }
    return true;
  }

  async function doRun(refs) {
    if (state.busy) return;
    var spec = refs.spec, opts = refs.options;
    if (!guardEditor(refs)) return;
    var test = spec.tests[0];
    var code = refs.editor.value;

    setBusy(refs, true);
    clearAlert(refs);
    clearResults(refs);
    setStatus(refs, "正在编译并运行…", "busy");

    var row = makeCase(refs, 0, test, true);
    var t0 = now();
    try {
      var res = await execute(code, test.input, assign({}, opts, { cacheKey: spec.id + "#run" }));
      var ms = now() - t0;
      if (res.compileError) {
        fillCase(row, "error", { badge: "编译失败", ms: ms, engine: res.engine, engineVersion: res.engineVersion, actual: res.stdout, stderr: res.compileError });
        showAlert(refs, "编译错误", "编译器没有通过这份代码，先修好语法再运行。", res.compileError);
        setStatus(refs, "❌ 编译失败", "bad");
      } else {
        var same = normalize(res.stdout) === normalize(test.output);
        fillCase(row, "info", {
          badge: same ? "输出与用例 1 一致" : "运行完成（未判题）",
          ms: ms, engine: res.engine, engineVersion: res.engineVersion, cached: res.cached,
          actual: res.stdout, stderr: res.stderr || res.warnings
        });
        setStatus(refs, "✅ 运行完成（" + fmtMs(ms) + "，" + res.engine + "）", "ok");
      }
    } catch (e) {
      fillCase(row, "error", { badge: "运行失败", ms: now() - t0, actual: "", stderr: describeError(e) });
      showAlert(refs, e && e.kind === "offline" ? OFFLINE_TEXT : "运行失败", describeError(e), (e && e.details) || "");
      setStatus(refs, e && e.kind === "offline" ? OFFLINE_TEXT : "❌ 运行失败", "bad");
    } finally {
      setBusy(refs, false);
    }
  }

  function describeError(e) {
    if (!e) return "未知错误";
    var msg = e.message || String(e);
    if (e.details) msg += "\n" + e.details;
    return msg;
  }

  async function doJudge(refs) {
    if (state.busy) return;
    var spec = refs.spec, opts = refs.options;
    if (!guardEditor(refs)) return;
    var code = refs.editor.value;
    var tests = spec.tests;

    setBusy(refs, true);
    clearAlert(refs);
    clearResults(refs);
    setStatus(refs, "正在判题（0 / " + tests.length + "）…", "busy");

    var passed = 0, failed = 0, errored = 0, skipped = 0;
    var compileFailed = false;
    var offline = false;
    var totalMs = 0;

    for (var i = 0; i < tests.length; i++) {
      var test = tests[i];
      setStatus(refs, "正在判题（" + (i + 1) + " / " + tests.length + "）…", "busy");
      var row = makeCase(refs, i, test, true);
      var t0 = now();
      var res;
      try {
        res = await execute(code, test.input, assign({}, opts, { cacheKey: spec.id }));
      } catch (e) {
        errored++;
        fillCase(row, "error", { badge: "无法评测", ms: now() - t0, actual: "", stderr: describeError(e) });
        if (e && e.kind === "offline") {
          offline = true;
          showAlert(refs, OFFLINE_TEXT, "本模块需要联网把代码送到在线编译器执行。请检查网络后重试；已经跑过的用例结果会保留在下面。", e.details || "");
          for (var k = i + 1; k < tests.length; k++) {
            skipped++;
            fillCase(makeCase(refs, k, tests[k], true), "error", { badge: "已跳过", stderr: OFFLINE_TEXT });
          }
          break;
        }
        continue;
      }

      var ms = now() - t0;
      totalMs += ms;

      if (res.compileError) {
        compileFailed = true;
        fillCase(row, "error", { badge: "编译失败", ms: ms, engine: res.engine, engineVersion: res.engineVersion, actual: res.stdout, stderr: res.compileError });
        showAlert(refs, "编译错误", "所有测试用例都无法通过编译，请先修复下面的错误。", res.compileError);
        for (var k2 = i + 1; k2 < tests.length; k2++) {
          skipped++;
          fillCase(makeCase(refs, k2, tests[k2], true), "error", { badge: "未运行", stderr: "编译失败，后续用例未执行" });
        }
        break;
      }

      var expected = normalize(test.output);
      var actual = normalize(res.stdout);
      var abnormal = isAbnormal(res.stderr, opts);
      var ok = (expected === actual) && !abnormal;
      if (ok) passed++; else failed++;

      fillCase(row, ok ? "pass" : "fail", {
        badge: ok ? "通过" : (abnormal ? "运行异常" : "答案错误"),
        ms: ms,
        engine: res.engine,
        engineVersion: res.engineVersion,
        cached: res.cached,
        expected: test.output,
        actual: res.stdout,
        stderr: res.stderr || res.warnings || "",
        hint: ok ? "" : (!abnormal && expected === actual ? "输出一致，但程序异常结束" : "")
      });
    }

    var summary, tone;
    if (compileFailed) {
      summary = "❌ 编译失败（0 / " + tests.length + " 通过）";
      tone = "bad";
    } else if (offline) {
      summary = OFFLINE_TEXT;
      tone = "bad";
    } else if (passed === tests.length) {
      summary = "✅ 全部通过（" + passed + " / " + tests.length + "）· 用时 " + fmtMs(totalMs);
      tone = "ok";
    } else if (errored > 0 && failed === 0) {
      summary = "⚠️ 有 " + errored + " 个用例无法评测";
      tone = "bad";
    } else {
      summary = "❌ 通过 " + passed + " / " + tests.length + "，未通过 " + (failed + errored + skipped) + " 个";
      tone = "bad";
    }
    setStatus(refs, summary, tone);
    setBusy(refs, false);
  }

  /* =====================================================================
     9. 挂载
     ===================================================================== */

  function mount(root, options) {
    if (!root || root.nodeType !== 1) return null;
    if (root.getAttribute("data-cj-mounted") === "1") return root.__cj || null;
    var spec = parseLab(root);
    if (!spec) return null;

    root.setAttribute("data-cj-mounted", "1");
    root.classList.add("cj");

    if (spec.error) {
      renderLabError(root, spec);
      return null;
    }

    var opts = mergeOpts(options, spec.options);
    var refs = buildUI(root, spec, opts);

    // 编辑器
    refs.editor.addEventListener("input", function () { syncGutter(refs); autoGrow(refs); });
    refs.editor.addEventListener("scroll", function () {
      if (refs.gutter) refs.gutter.scrollTop = refs.editor.scrollTop;
    });
    refs.editor.addEventListener("keydown", function (ev) { onEditorKeydown(ev, refs); });

    refs.runBtn.addEventListener("click", function () { doRun(refs); });
    refs.submitBtn.addEventListener("click", function () { doJudge(refs); });

    refs.copyBtn.addEventListener("click", function () {
      copyText(refs.editor.value).then(function (ok) {
        refs.copyBtn.textContent = ok ? "已复制 ✓" : "复制失败";
        setTimeout(function () { refs.copyBtn.textContent = "复制代码"; }, 1400);
      });
    });
    refs.resetBtn.addEventListener("click", function () {
      if (refs.editor.value !== spec.template && !window.confirm("确定要丢弃当前代码，恢复初始模板吗？")) return;
      refs.editor.value = spec.template;
      syncGutter(refs);
      autoGrow(refs);
      clearAlert(refs);
      clearResults(refs);
      setStatus(refs, "已重置为初始模板", null);
    });

    syncGutter(refs);
    autoGrow(refs);

    var handle = {
      root: root,
      spec: spec,
      source: spec.source,
      options: opts,
      refs: refs,
      getCode: function () { return refs.editor.value; },
      setCode: function (code) {
        refs.editor.value = String(code === undefined || code === null ? "" : code);
        syncGutter(refs);
        autoGrow(refs);
      },
      run: function () { return doRun(refs); },
      judge: function () { return doJudge(refs); },
      reset: function () { refs.resetBtn.click(); }
    };
    root.__cj = handle;
    return handle;
  }

  function mountAll(scope) {
    var node = scope && scope.nodeType === 1 ? scope : document;
    // 选中所有 .code-lab；没有题目 JSON 来源的容器会被 mount() 直接跳过，不做任何改动
    var list = node.querySelectorAll(".code-lab");
    var handles = [];
    for (var i = 0; i < list.length; i++) {
      var handle = mount(list[i]);
      if (handle) handles.push(handle);
    }
    return handles;
  }

  /* =====================================================================
     10. 对外接口
     ===================================================================== */

  var api = {
    installed: true,
    version: VERSION,
    OFFLINE_TEXT: OFFLINE_TEXT,
    config: DEFAULTS,
    engines: ENGINES,

    mount: mount,
    mountAll: mountAll,

    // 供其它脚本调用：CodeJudge.run(code, stdin) -> { stdout, stderr, compileError }
    run: function (code, stdin, options) {
      return execute(code, stdin, options).then(function (res) {
        return {
          stdout: res.stdout,
          stderr: res.stderr,
          compileError: res.compileError,
          warnings: res.warnings,
          engine: res.engine,
          engineVersion: res.engineVersion,
          cached: res.cached
        };
      });
    },

    // 与 run 相同，但返回完整字段（含引擎信息）
    execute: execute,
    clearCache: function () { state.cache.clear(); state.cacheHits = 0; },
    stats: function () {
      var down = [];
      for (var k in state.enginesDown) {
        if (Object.prototype.hasOwnProperty.call(state.enginesDown, k) && engineSkipped(k)) down.push(k);
      }
      return { requests: state.requests, cacheHits: state.cacheHits, cached: state.cache.size, enginesDown: down };
    }
  };

  window.CodeJudge = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { mountAll(); });
  } else {
    mountAll();
  }
})();
