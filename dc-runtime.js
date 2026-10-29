// Minimal standalone runtime for the prototype screens.
// Renders the page template (sc-if, sc-for, {{holes}}) from a DCLogic component
// and patches the DOM in place on every setState, so focus and scroll survive.
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (patch) {
    var next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, next);
    if (this.__schedule) this.__schedule();
  };
  window.DCLogic = DCLogic;

  // ---- holes ----
  var HOLE = /\{\{([\s\S]*?)\}\}/g;

  function lookup(path, scopes) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.');
    var head = parts[0], v;
    for (var i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i] != null && Object.prototype.hasOwnProperty.call(scopes[i], head)) { v = scopes[i][head]; break; }
    }
    for (var j = 1; j < parts.length && v != null; j++) v = v[parts[j]];
    return v;
  }

  function evalValue(str, scopes) {
    var m = /^\{\{([\s\S]*?)\}\}$/.exec(str);
    if (m && str.indexOf('{{', 2) === -1) return lookup(m[1], scopes);
    return str.replace(HOLE, function (_, p) { var v = lookup(p, scopes); return v == null || v === false ? '' : String(v); });
  }

  // ---- template -> vnodes ----
  function attr(node, name) {
    for (var i = 0; i < node.a.length; i++) if (node.a[i][0] === name) return node.a[i][1];
    return null;
  }

  function build(nodes, scopes, svg, out) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (typeof n === 'string') {
        var txt = n.indexOf('{{') === -1 ? n : evalValue(n, scopes);
        out.push({ text: txt == null || txt === false ? '' : String(txt) });
        continue;
      }
      if (n.t === 'sc-if') {
        if (evalValue(attr(n, 'value') || '', scopes)) build(n.c, scopes, svg, out);
        continue;
      }
      if (n.t === 'sc-for') {
        var list = evalValue(attr(n, 'list') || '', scopes) || [];
        var as = attr(n, 'as') || 'item';
        for (var k = 0; k < list.length; k++) {
          var sc = {}; sc[as] = list[k];
          build(n.c, scopes.concat([sc]), svg, out);
        }
        continue;
      }
      var isSvg = svg || n.t === 'svg';
      var v = { tag: n.t, svg: isSvg, attrs: {}, events: {}, children: [] };
      for (var a = 0; a < n.a.length; a++) {
        var name = n.a[a][0], raw = n.a[a][1];
        if (name.indexOf('hint-') === 0) continue;
        var val = raw.indexOf('{{') === -1 ? raw : evalValue(raw, scopes);
        if (/^on[A-Z]/.test(name)) {
          var type = name.slice(2).toLowerCase();
          if (type === 'change' && (n.t === 'input' || n.t === 'textarea')) type = 'input';
          if (typeof val === 'function') v.events[type] = val;
        } else {
          v.attrs[name] = val;
        }
      }
      build(n.c, scopes, isSvg, v.children);
      out.push(v);
    }
    return out;
  }

  // ---- DOM patching ----
  function dispatch(e) {
    var h = e.currentTarget.__h && e.currentTarget.__h[e.type];
    if (h) h(e);
  }

  function setAttr(el, name, val, isSvg) {
    var tag = el.tagName;
    if (name === 'value' && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) {
      var s = val == null ? '' : String(val);
      if (el.value !== s) el.value = s;
      return;
    }
    if (name === 'checked' && tag === 'INPUT') { el.checked = !!val && val !== 'false'; return; }
    if (name === 'disabled') {
      var on = !!val && val !== 'false';
      if (on) el.setAttribute('disabled', ''); else el.removeAttribute('disabled');
      return;
    }
    if (val == null || val === false) { el.removeAttribute(name); return; }
    var str = val === true ? '' : String(val);
    if (el.getAttribute(name) !== str) el.setAttribute(name, str);
  }

  function create(v) {
    if (v.text !== undefined) return document.createTextNode(v.text);
    var el = v.svg ? document.createElementNS(SVG_NS, v.tag) : document.createElement(v.tag);
    el.__h = {};
    update(el, null, v);
    return el;
  }

  function update(el, old, v) {
    var oa = old ? old.attrs : {};
    for (var k in oa) if (!(k in v.attrs)) el.removeAttribute(k);
    for (var n in v.attrs) if (!old || oa[n] !== v.attrs[n] || n === 'value') setAttr(el, n, v.attrs[n], v.svg);
    for (var t in v.events) { if (!el.__h[t]) el.addEventListener(t, dispatch); }
    el.__h = Object.assign({}, v.events);
    if (old) for (var ot in old.events) if (!v.events[ot]) el.removeEventListener(ot, dispatch);
    patchChildren(el, old ? old.children : [], v.children);
    el.__v = v;
  }

  function same(a, b) {
    if (a.text !== undefined || b.text !== undefined) return a.text !== undefined && b.text !== undefined;
    return a.tag === b.tag && a.svg === b.svg;
  }

  function patchChildren(parent, olds, news) {
    var nodes = parent.childNodes;
    for (var i = 0; i < news.length; i++) {
      var nv = news[i], ov = olds[i], el = nodes[i];
      if (!ov || !el) { parent.appendChild(create(nv)); continue; }
      if (!same(ov, nv)) { parent.replaceChild(create(nv), el); continue; }
      if (nv.text !== undefined) { if (el.nodeValue !== nv.text) el.nodeValue = nv.text; continue; }
      update(el, ov, nv);
    }
    while (parent.childNodes.length > news.length) parent.removeChild(parent.lastChild);
  }

  // ---- boot ----
  function params(defs) {
    var props = {};
    Object.keys(defs || {}).forEach(function (k) { if (k[0] !== '$' && defs[k] && 'default' in defs[k]) props[k] = defs[k]['default']; });
    try {
      new URLSearchParams(location.search).forEach(function (val, key) { if (key in props) props[key] = val; });
    } catch (e) {}
    return props;
  }

  function boot() {
    var tplEl = document.getElementById('dc-template');
    var scriptEl = document.querySelector('script[data-dc-script]');
    var root = document.getElementById('dc-root');
    var template = JSON.parse(tplEl.textContent);
    var defs = {};
    try { defs = JSON.parse(scriptEl.getAttribute('data-props') || '{}'); } catch (e) {}
    var Component = new Function('DCLogic', scriptEl.textContent + '\n;return Component;')(DCLogic);
    var comp = new Component(params(defs));
    var current = [], queued = false, mounted = false;
    function render() {
      queued = false;
      var next = build(template, [comp.renderVals()], false, []);
      patchChildren(root, current, next);
      current = next;
    }
    comp.__schedule = function () { if (mounted && !queued) { queued = true; Promise.resolve().then(render); } };
    render();
    mounted = true;
    if (comp.componentDidMount) comp.componentDidMount();
    window.addEventListener('pagehide', function () { if (comp.componentWillUnmount) comp.componentWillUnmount(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
