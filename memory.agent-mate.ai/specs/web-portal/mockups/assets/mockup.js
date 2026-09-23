/* 记忆门户原型 · 渐进增强脚本
   职责：四语言渲染 · 语言按钮组 · 对话框开合 · 复制回显 · URL 参数驱动的变体态。
   页面在脚本未执行时仍可读（HTML 内保留英文兜底文案）。 */
(function () {
  var STORAGE = window.PORTAL_I18N_STORAGE;
  var CATALOGS = window.PORTAL_I18N;
  var LANG = window.PORTAL_LOCALE_LANG;
  var LOCALES = window.PORTAL_LOCALES;

  function currentLocale() {
    var stored = window.localStorage.getItem(STORAGE);
    if (LOCALES.indexOf(stored) !== -1) return stored;
    return "EN";
  }

  function t(key, vars) {
    var loc = currentLocale();
    var catalog = CATALOGS[loc] || {};
    var en = CATALOGS.EN || {};
    var value = catalog[key];
    if (value == null || value === "") value = en[key];
    if (value == null || value === "") value = key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        value = value.replace(new RegExp("\\{" + name + "\\}", "g"), vars[name]);
      });
    }
    return value;
  }

  function applyI18n() {
    var loc = currentLocale();
    document.documentElement.lang = LANG[loc] || "en";

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      var vars = {};
      var raw = el.getAttribute("data-i18n-vars");
      if (raw) {
        try { vars = JSON.parse(raw); } catch (e) { vars = {}; }
      }
      var value = t(key, vars);
      if (el.dataset.i18nAttr) {
        el.setAttribute(el.dataset.i18nAttr, value);
      } else {
        el.textContent = value;
      }
    });

    var titleKey = document.body.getAttribute("data-title-key");
    var brand = t("brand");
    document.title = titleKey ? t(titleKey) + " — " + brand : brand;

    document.querySelectorAll(".locale-switch button").forEach(function (btn) {
      var on = btn.getAttribute("data-locale") === loc;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setLocale(loc) {
    if (LOCALES.indexOf(loc) === -1) return;
    window.localStorage.setItem(STORAGE, loc);
    applyI18n();
  }

  function bindLocale() {
    document.querySelectorAll(".locale-switch button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setLocale(btn.getAttribute("data-locale"));
      });
    });
  }

  function bindMenu() {
    var toggle = document.querySelector(".menu-toggle");
    var shell = document.querySelector(".app-shell");
    var sidebar = document.querySelector(".sidebar");
    if (!toggle || !shell || !sidebar) return;
    toggle.hidden = false;
    toggle.addEventListener("click", function () {
      shell.classList.toggle("is-nav-open");
      var open = shell.classList.contains("is-nav-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      sidebar.hidden = !open;
    });
    if (window.matchMedia("(max-width: 720px)").matches) sidebar.hidden = true;
  }

  function bindDialogs() {
    document.querySelectorAll("[data-open-dialog]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var dlg = document.getElementById(btn.getAttribute("data-open-dialog"));
        if (dlg) dlg.classList.add("is-open");
      });
    });
    document.querySelectorAll("[data-close-dialog]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var dlg = btn.closest(".dialog-backdrop");
        if (dlg) dlg.classList.remove("is-open");
      });
    });
    document.querySelectorAll(".dialog-backdrop").forEach(function (dlg) {
      dlg.addEventListener("click", function (e) {
        if (e.target === dlg) dlg.classList.remove("is-open");
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      document.querySelectorAll(".dialog-backdrop.is-open").forEach(function (dlg) {
        dlg.classList.remove("is-open");
      });
    });
  }

  /* 登出仿真：静态站不支持 POST，也无法真正结束会话（生产由 Cloudflare Access 接管）。
     这里拦截提交并跳到「需要身份」页 —— 等价于「登出后回到登出态」，于是
     「点登出 → 落到需要身份页」这一段在原型里可点通（ADR-018 的全路径仿真）。 */
  function bindLogout() {
    document.querySelectorAll("[data-logout]").forEach(function (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        window.location.href = form.getAttribute("action");
      });
    });
  }

  function bindCopy() {
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var text = btn.getAttribute("data-copy");
        if (!btn.getAttribute("data-i18n-idle")) {
          btn.setAttribute("data-i18n-idle", btn.getAttribute("data-i18n") || "");
        }
        var done = function () {
          btn.setAttribute("data-i18n", "common.copied");
          applyI18n();
          window.setTimeout(function () {
            btn.setAttribute("data-i18n", btn.getAttribute("data-i18n-idle") || "");
            applyI18n();
          }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, done);
        } else {
          done();
        }
      });
    });
  }

  function bindHandleField() {
    var input = document.getElementById("new-handle");
    if (!input) return;
    var valid = /^[a-z0-9_-]{1,32}$/;
    var feedback = document.querySelector("[data-handle-invalid]");
    var preview = document.querySelector("[data-handle-preview]");
    var submit = document.querySelector("[data-handle-submit]");
    function update() {
      var value = input.value || "";
      var ok = valid.test(value);
      input.classList.toggle("is-invalid", value !== "" && !ok);
      if (feedback) feedback.hidden = ok;
      if (preview) preview.textContent = value ? "/data/users/" + value + "/" : "/data/users/{handle}/";
      if (submit) submit.disabled = !ok;
    }
    input.addEventListener("input", update);
    update();
  }

  function applyQueryState() {
    var params = new URLSearchParams(window.location.search);

    var lang = params.get("lang");
    if (lang && LOCALES.indexOf(lang) !== -1) window.localStorage.setItem(STORAGE, lang);

    if (params.get("empty") === "1") {
      var table = document.querySelector("[data-users-table]");
      var empty = document.querySelector("[data-users-empty]");
      if (table) table.hidden = true;
      if (empty) empty.hidden = false;
    }
    if (params.get("error") === "1") {
      var err = document.querySelector("[data-error]");
      if (err) err.hidden = false;
    }
    if (params.get("invalid") === "1") {
      var input = document.getElementById("new-handle");
      if (input) {
        input.value = "Alice";
        input.dispatchEvent(new Event("input"));
      }
    }
    if (params.get("hover") === "contact") {
      var contact = document.querySelector(".contact-admin");
      if (contact) contact.classList.add("is-open");
    }
    if (params.get("nomatch") === "1") {
      var auditTable = document.querySelector("[data-audit-table]");
      var auditEmpty = document.querySelector("[data-audit-empty]");
      if (auditTable) auditTable.hidden = true;
      if (auditEmpty) auditEmpty.hidden = false;
    }
    var mode = params.get("mode");
    if (mode === "dev") {
      document.querySelectorAll("[data-dev-diagnostics]").forEach(function (el) { el.hidden = false; });
      document.querySelectorAll("[data-auth-dev]").forEach(function (el) { el.hidden = false; });
      document.querySelectorAll("[data-auth-prod]").forEach(function (el) { el.hidden = true; });
    }
    if (mode === "missing") {
      document.querySelectorAll("[data-dev-login-form]").forEach(function (el) { el.hidden = true; });
      document.querySelectorAll("[data-dev-login-missing]").forEach(function (el) { el.hidden = false; });
    }
    var confirm = params.get("confirm");
    if (confirm) {
      var dlg = document.getElementById("dialog-" + confirm);
      if (dlg) dlg.classList.add("is-open");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindLocale();
    bindMenu();
    bindDialogs();
    bindLogout();
    bindCopy();
    bindHandleField();
    applyQueryState();
    applyI18n();
  });

  window.portalT = t;
})();
