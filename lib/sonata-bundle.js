/* @sonata/ui bundle, wrapped as a client-only side-effect module for Next.js.
   Generated from _ds_bundle.js — do not edit by hand. */
import * as React from 'react';
if (typeof window !== 'undefined') {
  // Plain object copy: the ESM namespace is read-only and the shim below mutates window.React.
  if (!window.React) window.React = Object.assign({}, React);
/* @ds-bundle: {"namespace":"SonataUI","components":[{"name":"Button","sourcePath":"components/actions/Button/Button.jsx"},{"name":"Chip","sourcePath":"components/status/Chip/Chip.jsx"},{"name":"DataTable","sourcePath":"components/data/DataTable/DataTable.jsx"},{"name":"Field","sourcePath":"components/forms/Field/Field.jsx"},{"name":"KeyValueList","sourcePath":"components/data/KeyValueList/KeyValueList.jsx"},{"name":"Numeral","sourcePath":"components/brand/Numeral/Numeral.jsx"},{"name":"Segmented","sourcePath":"components/forms/Segmented/Segmented.jsx"},{"name":"StaffLines","sourcePath":"components/brand/StaffLines/StaffLines.jsx"},{"name":"Stat","sourcePath":"components/data/Stat/Stat.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs/Tabs.jsx"}],"sourceHashes":{"components/actions/Button/Button.jsx":"f254fd056a89","components/actions/Button/Button.d.ts":"48da87cff863","components/actions/Button/Button.prompt.md":"9c34c46becc4","components/status/Chip/Chip.jsx":"c52b2ec83321","components/status/Chip/Chip.d.ts":"f79bcfd39b89","components/status/Chip/Chip.prompt.md":"70f9d6e29b05","components/data/DataTable/DataTable.jsx":"4549a2fb9419","components/data/DataTable/DataTable.d.ts":"2ee3df7981f7","components/data/DataTable/DataTable.prompt.md":"cb9b9c4082be","components/forms/Field/Field.jsx":"41ace0a60baa","components/forms/Field/Field.d.ts":"a783cbbf105b","components/forms/Field/Field.prompt.md":"77790eecdca4","components/data/KeyValueList/KeyValueList.jsx":"03328117883b","components/data/KeyValueList/KeyValueList.d.ts":"ca314141f910","components/data/KeyValueList/KeyValueList.prompt.md":"63fc7b20451e","components/brand/Numeral/Numeral.jsx":"352b58a1ee40","components/brand/Numeral/Numeral.d.ts":"270c60868fad","components/brand/Numeral/Numeral.prompt.md":"8b4364e3698e","components/forms/Segmented/Segmented.jsx":"61a31c512d0c","components/forms/Segmented/Segmented.d.ts":"99531e2e7bb9","components/forms/Segmented/Segmented.prompt.md":"41cbef7bf43e","components/brand/StaffLines/StaffLines.jsx":"8d8a1d2d7ea8","components/brand/StaffLines/StaffLines.d.ts":"51b3c31a3852","components/brand/StaffLines/StaffLines.prompt.md":"6aeb45e988b0","components/data/Stat/Stat.jsx":"7acf8aafae6f","components/data/Stat/Stat.d.ts":"f01a55820dcb","components/data/Stat/Stat.prompt.md":"60623ed0b92f","components/navigation/Tabs/Tabs.jsx":"d72081b7e89b","components/navigation/Tabs/Tabs.d.ts":"80101735c566","components/navigation/Tabs/Tabs.prompt.md":"4ebd4187f6ca"},"inlinedExternals":[],"builtBy":"cc-design-sync"} */
"use strict";
var SonataUI = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // <define:import.meta.env>
  var init_define_import_meta_env = __esm({
    "<define:import.meta.env>"() {
    }
  });

  // shim:react-shim
  var require_react_shim = __commonJS({
    "shim:react-shim"(exports, module) {
      init_define_import_meta_env();
      var R = window.React;
      function np(p, k) {
        var o = {};
        for (var x in p) if (x !== "children") o[x] = p[x];
        if (k !== void 0) o.key = k;
        return o;
      }
      function jsx(t, p, k) {
        var c = p && p.children;
        return c === void 0 ? R.createElement(t, np(p, k)) : R.createElement(t, np(p, k), c);
      }
      function jsxs(t, p, k) {
        return R.createElement.apply(R, [t, np(p, k)].concat(p.children));
      }
      module.exports = R;
      module.exports.jsx = jsx;
      module.exports.jsxs = jsxs;
      module.exports.jsxDEV = function(t, p, k, s) {
        return (s ? jsxs : jsx)(t, p, k);
      };
      module.exports.Fragment = R.Fragment;
    }
  });

  // dist/index.js
  var index_exports = {};
  __export(index_exports, {
    Button: () => Button,
    Chip: () => Chip,
    DataTable: () => DataTable,
    Field: () => Field,
    KeyValueList: () => KeyValueList,
    Numeral: () => Numeral,
    Segmented: () => Segmented,
    StaffLines: () => StaffLines,
    Stat: () => Stat,
    Tabs: () => Tabs,
    toRoman: () => toRoman
  });
  init_define_import_meta_env();

  // dist/components/Button.js
  init_define_import_meta_env();
  var import_jsx_runtime2 = __toESM(require_react_shim(), 1);

  // dist/components/icons.js
  init_define_import_meta_env();
  var import_jsx_runtime = __toESM(require_react_shim(), 1);
  var base = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true };
  function ArrowRightIcon(props) {
    return (0, import_jsx_runtime.jsx)("svg", { ...base, ...props, children: (0, import_jsx_runtime.jsx)("path", { d: "M3 8h10M9 4l4 4-4 4" }) });
  }
  function CheckIcon(props) {
    return (0, import_jsx_runtime.jsx)("svg", { ...base, ...props, children: (0, import_jsx_runtime.jsx)("path", { d: "M3 8.5l3 3 7-7" }) });
  }
  function ClockIcon(props) {
    return (0, import_jsx_runtime.jsxs)("svg", { ...base, ...props, children: [(0, import_jsx_runtime.jsx)("circle", { cx: "8", cy: "8", r: "6" }), (0, import_jsx_runtime.jsx)("path", { d: "M8 4.5V8l2.5 1.5" })] });
  }
  function AlertIcon(props) {
    return (0, import_jsx_runtime.jsxs)("svg", { ...base, ...props, children: [(0, import_jsx_runtime.jsx)("path", { d: "M8 2.5L14 13H2L8 2.5z" }), (0, import_jsx_runtime.jsx)("path", { d: "M8 6.5v3M8 11.2v.3" })] });
  }

  // dist/components/Button.js
  function Button({ variant = "primary", size = "md", arrow = false, fullWidth = false, className, children, type = "button", ...rest }) {
    const cls = ["sn-button", variant !== "primary" ? `sn-button--${variant}` : "", size === "lg" ? "sn-button--lg" : "", fullWidth ? "sn-button--full" : "", className ?? ""].filter(Boolean).join(" ");
    return (0, import_jsx_runtime2.jsxs)("button", { type, className: cls, ...rest, children: [(0, import_jsx_runtime2.jsx)("span", { children }), arrow ? (0, import_jsx_runtime2.jsx)(ArrowRightIcon, { className: "sn-button__icon" }) : null] });
  }

  // dist/components/Chip.js
  init_define_import_meta_env();
  var import_jsx_runtime3 = __toESM(require_react_shim(), 1);
  var icons = {
    good: CheckIcon,
    warning: ClockIcon,
    failed: AlertIcon
  };
  function Chip({ tone = "neutral", className, children, ...rest }) {
    const Icon = tone === "good" || tone === "warning" || tone === "failed" ? icons[tone] : null;
    const cls = ["sn-chip", tone !== "neutral" ? `sn-chip--${tone}` : "", className ?? ""].filter(Boolean).join(" ");
    return (0, import_jsx_runtime3.jsxs)("span", { className: cls, ...rest, children: [Icon ? (0, import_jsx_runtime3.jsx)(Icon, { className: "sn-chip__icon" }) : null, (0, import_jsx_runtime3.jsx)("span", { children })] });
  }

  // dist/components/Field.js
  init_define_import_meta_env();
  var import_jsx_runtime4 = __toESM(require_react_shim(), 1);
  function Field({ label, hint, action, onAction, mono = false, invalid = false, className, id, ...rest }) {
    const inputId = id ?? `sn-field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const cls = ["sn-field", mono ? "sn-field--mono" : "", invalid ? "sn-field--invalid" : "", className ?? ""].filter(Boolean).join(" ");
    return (0, import_jsx_runtime4.jsxs)("div", { className: cls, children: [(0, import_jsx_runtime4.jsx)("label", { className: "sn-field__label", htmlFor: inputId, children: label }), (0, import_jsx_runtime4.jsxs)("div", { className: "sn-field__box", children: [(0, import_jsx_runtime4.jsx)("input", { id: inputId, className: "sn-field__input", "aria-invalid": invalid || void 0, ...rest }), action ? (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "sn-field__action", onClick: onAction, children: action }) : null] }), hint ? (0, import_jsx_runtime4.jsx)("div", { className: "sn-field__hint", children: hint }) : null] });
  }

  // dist/components/Segmented.js
  init_define_import_meta_env();
  var import_jsx_runtime5 = __toESM(require_react_shim(), 1);
  function Segmented({ options, value, onChange, ariaLabel, className }) {
    return (0, import_jsx_runtime5.jsx)("div", { className: ["sn-segmented", className ?? ""].filter(Boolean).join(" "), role: "radiogroup", "aria-label": ariaLabel, children: options.map((opt) => {
      const active = opt.value === value;
      return (0, import_jsx_runtime5.jsx)("button", { type: "button", role: "radio", "aria-checked": active, className: ["sn-segmented__option", active ? "sn-segmented__option--active" : ""].filter(Boolean).join(" "), onClick: () => onChange?.(opt.value), children: opt.label }, opt.value);
    }) });
  }

  // dist/components/Tabs.js
  init_define_import_meta_env();
  var import_jsx_runtime6 = __toESM(require_react_shim(), 1);
  function Tabs({ items, active, onChange, className }) {
    return (0, import_jsx_runtime6.jsx)("div", { className: ["sn-tabs", className ?? ""].filter(Boolean).join(" "), role: "tablist", children: items.map((item) => {
      const isActive = item.id === active;
      return (0, import_jsx_runtime6.jsxs)("button", { type: "button", role: "tab", "aria-selected": isActive, className: ["sn-tabs__item", isActive ? "sn-tabs__item--active" : ""].filter(Boolean).join(" "), onClick: () => onChange?.(item.id), children: [(0, import_jsx_runtime6.jsx)("span", { children: item.label }), item.count !== void 0 ? (0, import_jsx_runtime6.jsx)("span", { className: "sn-tabs__count", children: item.count }) : null] }, item.id);
    }) });
  }

  // dist/components/Stat.js
  init_define_import_meta_env();
  var import_jsx_runtime7 = __toESM(require_react_shim(), 1);
  function Stat({ label, value, unit, note, className }) {
    return (0, import_jsx_runtime7.jsxs)("div", { className: ["sn-stat", className ?? ""].filter(Boolean).join(" "), children: [(0, import_jsx_runtime7.jsx)("div", { className: "sn-stat__label", children: label }), (0, import_jsx_runtime7.jsxs)("div", { className: "sn-stat__value", children: [value, unit ? (0, import_jsx_runtime7.jsx)("span", { className: "sn-stat__unit", children: unit }) : null] }), note ? (0, import_jsx_runtime7.jsx)("div", { className: "sn-stat__note", children: note }) : null] });
  }

  // dist/components/KeyValueList.js
  init_define_import_meta_env();
  var import_jsx_runtime8 = __toESM(require_react_shim(), 1);
  function KeyValueList({ rows, className }) {
    return (0, import_jsx_runtime8.jsx)("div", { className: ["sn-kv", className ?? ""].filter(Boolean).join(" "), children: rows.map((row) => (0, import_jsx_runtime8.jsxs)("div", { className: "sn-kv__row", children: [(0, import_jsx_runtime8.jsx)("div", { className: "sn-kv__key", children: row.key }), (0, import_jsx_runtime8.jsx)("div", { className: ["sn-kv__value", row.mono === false ? "sn-kv__value--text" : ""].filter(Boolean).join(" "), children: row.value })] }, row.key)) });
  }

  // dist/components/DataTable.js
  init_define_import_meta_env();
  var import_jsx_runtime9 = __toESM(require_react_shim(), 1);
  function DataTable({ columns, rows, rowKey, className }) {
    const template = columns.map((c) => c.width ?? "minmax(0, 1fr)").join(" ");
    const cellClass = (c) => ["sn-table__cell", c.mono ? "sn-table__cell--mono" : "", c.align === "right" ? "sn-table__cell--right" : "", c.strong ? "sn-table__cell--strong" : ""].filter(Boolean).join(" ");
    return (0, import_jsx_runtime9.jsxs)("div", { className: ["sn-table", className ?? ""].filter(Boolean).join(" "), role: "table", children: [(0, import_jsx_runtime9.jsx)("div", { className: "sn-table__head", role: "row", style: { gridTemplateColumns: template }, children: columns.map((c) => (0, import_jsx_runtime9.jsx)("div", { role: "columnheader", className: c.align === "right" ? "sn-table__cell sn-table__cell--right" : "sn-table__cell", children: c.header }, c.key)) }), rows.map((row, i) => (0, import_jsx_runtime9.jsx)("div", { className: "sn-table__row", role: "row", style: { gridTemplateColumns: template }, children: columns.map((c) => (0, import_jsx_runtime9.jsx)("div", { role: "cell", className: cellClass(c), children: row[c.key] }, c.key)) }, rowKey ? rowKey(row, i) : String(i)))] });
  }

  // dist/components/StaffLines.js
  init_define_import_meta_env();
  var import_jsx_runtime10 = __toESM(require_react_shim(), 1);
  function StaffLines({ width = 520, height = 160, marks = "full", className }) {
    const step = height / 5;
    const ys = [0, 1, 2, 3, 4].map((i) => Math.round(step * (i + 0.5)) + 0.5);
    const r = Math.min(step * 2, width / 6);
    const showArcs = marks === "full" || marks === "arcs";
    const showNotes = marks === "full" || marks === "notes";
    const x = (f) => Math.round(width * f);
    return (0, import_jsx_runtime10.jsxs)("svg", { className: ["sn-staff", className ?? ""].filter(Boolean).join(" "), width, height, viewBox: `0 0 ${width} ${height}`, fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", children: [(0, import_jsx_runtime10.jsx)("g", { stroke: "var(--sn-hairline)", strokeWidth: 1, children: ys.map((y) => (0, import_jsx_runtime10.jsx)("line", { x1: 0, y1: y, x2: width, y2: y }, y)) }), showArcs ? (0, import_jsx_runtime10.jsxs)("g", { stroke: "var(--sn-accent)", strokeWidth: 1.5, children: [(0, import_jsx_runtime10.jsx)("path", { d: `M${x(0.08)} ${ys[4]} A${r} ${r} 0 0 1 ${x(0.08) + 2 * r} ${ys[4]}` }), (0, import_jsx_runtime10.jsx)("path", { d: `M${x(0.42)} ${ys[0]} A${r} ${r} 0 0 0 ${x(0.42) + 2 * r} ${ys[0]}` }), (0, import_jsx_runtime10.jsx)("path", { d: `M${x(0.72)} ${ys[4]} A${r} ${r} 0 0 1 ${x(0.72) + 2 * r} ${ys[4]}` })] }) : null, showNotes ? (0, import_jsx_runtime10.jsxs)("g", { children: [(0, import_jsx_runtime10.jsx)("circle", { cx: x(0.24), cy: ys[2], r: 6, fill: "var(--sn-accent)" }), (0, import_jsx_runtime10.jsx)("line", { x1: x(0.24) + 6, y1: ys[2], x2: x(0.24) + 6, y2: ys[0], stroke: "var(--sn-ink)", strokeWidth: 1.5 }), (0, import_jsx_runtime10.jsx)("circle", { cx: x(0.55), cy: ys[1], r: 6, fill: "var(--sn-ink)" }), (0, import_jsx_runtime10.jsx)("line", { x1: x(0.55) + 6, y1: ys[1], x2: x(0.55) + 6, y2: Math.max(2, ys[1] - step * 1.6), stroke: "var(--sn-ink)", strokeWidth: 1.5 }), (0, import_jsx_runtime10.jsx)("circle", { cx: x(0.86), cy: ys[3], r: 6, fill: "var(--sn-accent)" }), (0, import_jsx_runtime10.jsx)("line", { x1: x(0.86) + 6, y1: ys[3], x2: x(0.86) + 6, y2: ys[1], stroke: "var(--sn-ink)", strokeWidth: 1.5 })] }) : null] });
  }

  // dist/components/Numeral.js
  init_define_import_meta_env();
  var import_jsx_runtime11 = __toESM(require_react_shim(), 1);
  var ROMAN = [[1e3, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  function toRoman(n) {
    let value = Math.max(1, Math.floor(n));
    let out = "";
    for (const [num, sym] of ROMAN) {
      while (value >= num) {
        out += sym;
        value -= num;
      }
    }
    return out;
  }
  function Numeral({ index, size = "md", className }) {
    return (0, import_jsx_runtime11.jsx)("span", { className: ["sn-numeral", size === "lg" ? "sn-numeral--lg" : "", className ?? ""].filter(Boolean).join(" "), children: toRoman(index) });
  }
  return __toCommonJS(index_exports);
})();
window.SonataUI=SonataUI.__dsMainNs?Object.assign({},SonataUI,SonataUI.__dsMainNs,{__dsMainNs:undefined}):SonataUI;

}
