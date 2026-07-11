import { BrowserWindow as e, Menu as t, Notification as n, Tray as r, app as i, dialog as a, ipcMain as o, nativeImage as s, powerSaveBlocker as c, safeStorage as l, shell as u } from "electron";
import d from "node:path";
import f from "node:fs";
import { fileURLToPath as ee } from "node:url";
import te from "node:http";
import { spawn as p } from "node:child_process";
import { randomUUID as ne } from "node:crypto";
import m from "node:os";
//#region electron/webhookServer.ts
var h = null, g = {
	running: !1,
	port: 8787,
	token: "",
	url: null,
	lastError: null,
	hitCount: 0
}, re = null;
function ie(e) {
	return new Promise((t, n) => {
		let r = [];
		e.on("data", (e) => r.push(Buffer.isBuffer(e) ? e : Buffer.from(e))), e.on("end", () => t(Buffer.concat(r).toString("utf-8"))), e.on("error", n);
	});
}
function _(e, t, n) {
	let r = JSON.stringify(n);
	e.writeHead(t, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "Content-Type, Authorization, X-Webhook-Token",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS"
	}), e.end(r);
}
function ae(e, t, n) {
	let r = e;
	try {
		r = e ? JSON.parse(e) : {};
	} catch {
		r = { text: e };
	}
	let i = r && typeof r == "object" ? r : {};
	return {
		receivedAt: (/* @__PURE__ */ new Date()).toISOString(),
		path: t,
		source: String(i.source || i.event || i.type || "webhook.http"),
		subject: i.subject == null ? void 0 : String(i.subject),
		hasAttachment: i.hasAttachment == null ? i.attachment == null ? void 0 : !!i.attachment : !!i.hasAttachment,
		body: i.body == null ? i.text == null ? void 0 : String(i.text) : String(i.body),
		keyword: i.keyword == null ? void 0 : String(i.keyword),
		headers: n,
		raw: r
	};
}
function oe(e) {
	re = e;
}
function v() {
	return { ...g };
}
async function se(e) {
	h && await ce();
	let t = e.port && e.port > 0 ? e.port : 8787, n = e.token || "";
	return h = te.createServer(async (e, t) => {
		let r = e.url || "/", i = (e.method || "GET").toUpperCase();
		if (i === "OPTIONS") {
			_(t, 204, {});
			return;
		}
		if (i === "GET" && (r === "/" || r === "/health")) {
			_(t, 200, {
				ok: !0,
				service: "SubAgents AI Webhook",
				endpoints: [
					"POST /webhook",
					"POST /events",
					"GET /health"
				],
				hits: g.hitCount
			});
			return;
		}
		if (i === "POST" && (r.startsWith("/webhook") || r.startsWith("/events"))) {
			if (n) {
				let r = e.headers.authorization || "", i = String(e.headers["x-webhook-token"] || "");
				if ((r.startsWith("Bearer ") ? r.slice(7) : "") !== n && i !== n) {
					_(t, 401, {
						ok: !1,
						error: "Unauthorized"
					});
					return;
				}
			}
			try {
				let n = await ie(e), i = {};
				for (let [t, n] of Object.entries(e.headers)) typeof n == "string" ? i[t] = n : Array.isArray(n) && (i[t] = n.join(","));
				let a = ae(n, r, i);
				g.hitCount += 1, re?.(a), _(t, 202, {
					ok: !0,
					accepted: !0,
					source: a.source,
					receivedAt: a.receivedAt
				});
			} catch (e) {
				_(t, 400, {
					ok: !1,
					error: e instanceof Error ? e.message : String(e)
				});
			}
			return;
		}
		_(t, 404, {
			ok: !1,
			error: "Not found"
		});
	}), await new Promise((e, r) => {
		h.once("error", (e) => {
			g.lastError = e.message, g.running = !1, g.url = null, h = null, r(e);
		}), h.listen(t, "127.0.0.1", () => {
			g = {
				running: !0,
				port: t,
				token: n,
				url: `http://127.0.0.1:${t}/webhook`,
				lastError: null,
				hitCount: g.hitCount
			}, e();
		});
	}), v();
}
async function ce() {
	if (!h) return g.running = !1, g.url = null, v();
	let e = h;
	return h = null, await new Promise((t) => {
		e.close(() => t());
	}), g.running = !1, g.url = null, v();
}
//#endregion
//#region electron/mcpBridge.ts
var le = class {
	id;
	command;
	args;
	child = null;
	nextId = 1;
	pending = /* @__PURE__ */ new Map();
	buf = Buffer.alloc(0);
	mode = "unknown";
	alive = !1;
	startedAt = null;
	lastError = null;
	requestCount = 0;
	initPromise = null;
	constructor(e, t, n) {
		this.id = e, this.command = t, this.args = n;
	}
	get pid() {
		return this.child?.pid ?? null;
	}
	status() {
		return {
			id: this.id,
			command: this.command,
			args: this.args,
			alive: this.alive && !!this.child && !this.child.killed,
			pid: this.pid,
			startedAt: this.startedAt,
			lastError: this.lastError,
			requestCount: this.requestCount
		};
	}
	async start() {
		if (!(this.alive && this.child && !this.child.killed)) {
			if (this.initPromise) return this.initPromise;
			this.initPromise = this._start();
			try {
				await this.initPromise;
			} finally {
				this.initPromise = null;
			}
		}
	}
	_start() {
		return new Promise((e, t) => {
			if (!this.command) {
				t(/* @__PURE__ */ Error("stdio MCP command is empty"));
				return;
			}
			try {
				this.child = p(this.command, this.args, {
					stdio: [
						"pipe",
						"pipe",
						"pipe"
					],
					env: { ...process.env }
				});
			} catch (e) {
				t(e instanceof Error ? e : Error(String(e)));
				return;
			}
			this.buf = Buffer.alloc(0), this.mode = "unknown", this.alive = !0, this.startedAt = (/* @__PURE__ */ new Date()).toISOString(), this.lastError = null, this.child.stdout.on("data", (e) => this.onData(e)), this.child.stderr.on("data", () => {}), this.child.on("error", (e) => {
				this.lastError = e.message, this.failAll(e), this.alive = !1;
			}), this.child.on("close", (e) => {
				this.alive = !1, this.failAll(/* @__PURE__ */ Error(`MCP stdio exited (code ${e})`));
			}), this.request("initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: {
					name: "subagents-ai",
					version: "1.0.0"
				}
			}).then(() => {
				this.notify("notifications/initialized", {}), e();
			}).catch((e) => {
				this.stop(), t(e instanceof Error ? e : Error(String(e)));
			});
		});
	}
	onData(e) {
		for (this.buf = Buffer.concat([this.buf, e]);;) {
			let e = this.tryReadMessage();
			if (!e) break;
			this.handleMessage(e);
		}
	}
	tryReadMessage() {
		if (this.buf.length === 0) return null;
		let e = this.buf.toString("utf-8");
		if (this.mode === "unknown" && ((/^Content-Length:/i.test(e) || e.includes("\r\n\r\n") || e.includes("\n\n")) && (/Content-Length:/i.test(e.slice(0, 64)) || /content-length:/i.test(e)) && (this.mode = "content-length"), this.mode === "unknown" && e.includes("\n") && e.trimStart().startsWith("{") && (this.mode = "ndjson")), this.mode === "content-length" || this.mode === "unknown" && /Content-Length:/i.test(e)) {
			this.mode = "content-length";
			let t = e.indexOf("\r\n\r\n"), n = e.indexOf("\n\n"), r = -1, i = 2;
			if (t >= 0 && (n < 0 || t <= n) ? (r = t, i = 4) : n >= 0 && (r = n, i = 2), r < 0) return null;
			let a = e.slice(0, r).match(/Content-Length:\s*(\d+)/i);
			if (!a) {
				let t = e.indexOf("\n");
				return t >= 0 && (this.buf = this.buf.subarray(t + 1)), null;
			}
			let o = parseInt(a[1], 10), s = r + i, c = Buffer.byteLength(e.slice(0, s), "utf-8");
			if (this.buf.length < c + o) return null;
			let l = this.buf.subarray(c, c + o);
			this.buf = this.buf.subarray(c + o);
			try {
				return JSON.parse(l.toString("utf-8"));
			} catch {
				return null;
			}
		}
		this.mode = "ndjson";
		let t = e.indexOf("\n");
		if (t < 0) return null;
		let n = e.slice(0, t).trim();
		if (this.buf = this.buf.subarray(Buffer.byteLength(e.slice(0, t + 1), "utf-8")), !n) return this.tryReadMessage();
		try {
			return JSON.parse(n);
		} catch {
			return null;
		}
	}
	handleMessage(e) {
		if (e.id == null) return;
		let t = typeof e.id == "number" ? e.id : Number(e.id), n = this.pending.get(t);
		n && (clearTimeout(n.timer), this.pending.delete(t), e.error ? n.reject(Error(e.error.message || `MCP error ${e.error.code}`)) : n.resolve(e.result));
	}
	failAll(e) {
		for (let [, t] of this.pending) clearTimeout(t.timer), t.reject(e);
		this.pending.clear();
	}
	write(e) {
		if (!this.child || !this.alive) throw Error("MCP session not alive");
		let t = JSON.stringify(e), n = `Content-Length: ${Buffer.byteLength(t, "utf-8")}\r\n\r\n${t}`;
		this.child.stdin.write(n);
	}
	notify(e, t) {
		try {
			this.write({
				jsonrpc: "2.0",
				method: e,
				params: t || {}
			});
		} catch {}
	}
	request(e, t, n = 6e4) {
		if (!this.child || !this.alive) return Promise.reject(/* @__PURE__ */ Error("MCP session not alive"));
		let r = this.nextId++;
		return this.requestCount += 1, new Promise((i, a) => {
			let o = setTimeout(() => {
				this.pending.delete(r), a(/* @__PURE__ */ Error(`MCP request timeout: ${e}`));
			}, n);
			this.pending.set(r, {
				resolve: i,
				reject: a,
				timer: o
			});
			try {
				this.write({
					jsonrpc: "2.0",
					id: r,
					method: e,
					params: t || {}
				});
			} catch (e) {
				clearTimeout(o), this.pending.delete(r), a(e instanceof Error ? e : Error(String(e)));
			}
		});
	}
	stop() {
		if (this.alive = !1, this.failAll(/* @__PURE__ */ Error("MCP session stopped")), this.child && !this.child.killed) {
			try {
				this.child.stdin.end();
			} catch {}
			this.child.kill();
		}
		this.child = null;
	}
}, y = /* @__PURE__ */ new Map();
function ue(e, t, n) {
	return `${e}::${t}::${(n || []).join("\0")}`;
}
async function de(e) {
	let t = await fetch(e.url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			...e.headers || {}
		},
		body: JSON.stringify(e.body)
	});
	if (!t.ok) {
		let e = await t.text().catch(() => t.statusText);
		throw Error(`MCP HTTP ${t.status}: ${e.slice(0, 300)}`);
	}
	let n = await t.json();
	if (n.error) throw Error(n.error.message || "MCP error");
	return n.result;
}
async function fe(e) {
	let t = ue(e.id, e.command, e.args || []), n = y.get(t);
	if (!n || !n.alive) {
		for (let [n, r] of y) r.id === e.id && n !== t && (r.stop(), y.delete(n));
		n = new le(e.id, e.command, e.args || []), y.set(t, n), await n.start();
	}
	return n.status();
}
async function pe(e) {
	let t = ue(e.id, e.command, e.args || []);
	await fe(e);
	let n = y.get(t);
	if (!n) throw Error("session missing after ensure");
	return (await n.request("tools/list", {}))?.tools || [];
}
async function me(e) {
	try {
		let t = ue(e.id, e.command, e.args || []);
		await fe(e);
		let n = y.get(t);
		if (!n) throw Error("session missing");
		return {
			ok: !0,
			content: ve(await n.request("tools/call", {
				name: e.toolName,
				arguments: e.arguments || {}
			}))
		};
	} catch (e) {
		return {
			ok: !1,
			content: "",
			error: e instanceof Error ? e.message : String(e)
		};
	}
}
function he(e) {
	let t = !1;
	for (let [n, r] of y) (r.id === e || n.startsWith(`${e}::`)) && (r.stop(), y.delete(n), t = !0);
	return { ok: t };
}
function ge() {
	let e = 0;
	for (let [, t] of y) t.stop(), e += 1;
	return y.clear(), {
		ok: !0,
		stopped: e
	};
}
function _e() {
	return [...y.values()].map((e) => e.status());
}
function ve(e) {
	if (e == null) return "(empty)";
	if (typeof e == "string") return e;
	let t = e;
	return Array.isArray(t.content) ? t.content.map((e) => e.text || JSON.stringify(e)).join("\n") : JSON.stringify(e, null, 2).slice(0, 8e3);
}
//#endregion
//#region electron/messagingGateway.ts
var ye = null, b = !1, x = !1, S = null, be = "", C = /* @__PURE__ */ new Set(), w = 0, xe = 0, Se = null, T = null, Ce = null;
function we(e) {
	ye = e;
}
function E() {
	return { telegram: {
		running: x,
		botUsername: Ce,
		lastError: T,
		updateOffset: w,
		messageCount: xe,
		lastMessageAt: Se
	} };
}
function Te(e) {
	if (!e) return /* @__PURE__ */ new Set();
	let t = Array.isArray(e) ? e : e.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean);
	return new Set(t.map(String));
}
async function D(e, t, n) {
	let r = `https://api.telegram.org/bot${e}/${t}`, i = await (await fetch(r, {
		method: n ? "POST" : "GET",
		headers: n ? { "Content-Type": "application/json" } : void 0,
		body: n ? JSON.stringify(n) : void 0
	})).json();
	if (!i.ok) throw Error(i.description || `Telegram API ${t} failed`);
	return i.result;
}
async function Ee(e) {
	try {
		Ce = (await D(e, "getMe")).username || null;
	} catch (e) {
		T = e instanceof Error ? e.message : String(e);
	}
	for (; !b;) try {
		let t = await D(e, "getUpdates", {
			offset: w,
			timeout: 25,
			allowed_updates: ["message"]
		});
		for (let e of t || []) {
			w = e.update_id + 1;
			let t = e.message;
			if (!t?.text) continue;
			let n = String(t.chat.id);
			if (C.size > 0 && !C.has(n)) continue;
			xe += 1, Se = (/* @__PURE__ */ new Date()).toISOString();
			let r = {
				channel: "telegram",
				chatId: n,
				text: t.text,
				from: t.from?.username || t.from?.first_name,
				messageId: t.message_id,
				receivedAt: Se,
				raw: e
			};
			ye?.(r);
		}
		T = null;
	} catch (e) {
		T = e instanceof Error ? e.message : String(e), await De(3e3);
	}
}
function De(e) {
	return new Promise((t) => setTimeout(t, e));
}
async function Oe(e) {
	let t = (e.token || "").trim();
	return t ? (x && await O(), be = t, C = Te(e.allowedChatIds), b = !1, x = !0, T = null, S = Ee(t).finally(() => {
		x = !1, S = null;
	}), E()) : (T = "缺少 Telegram Bot Token", E());
}
async function O() {
	return b = !0, x = !1, S && await Promise.race([S, De(500)]), E();
}
async function ke(e) {
	let t = (e.text || "").slice(0, 4e3);
	if (!t) return {
		ok: !1,
		error: "empty text"
	};
	if (e.channel === "telegram") {
		let n = (e.token || be).trim();
		if (!n) return {
			ok: !1,
			error: "Telegram token missing"
		};
		try {
			return await D(n, "sendMessage", {
				chat_id: e.chatId,
				text: t
			}), { ok: !0 };
		} catch (e) {
			return {
				ok: !1,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	}
	return {
		ok: !1,
		error: `channel ${e.channel} send not supported`
	};
}
//#endregion
//#region electron/shellBridge.ts
var k = /* @__PURE__ */ new Map();
function Ae(e) {
	let t = [];
	if (e?.runId) k.has(e.runId) && t.push(e.runId);
	else if (e?.tag) for (let [n, r] of k) r.tag === e.tag && t.push(n);
	else t.push(...k.keys());
	let n = 0;
	for (let e of t) {
		let t = k.get(e);
		if (t) try {
			t.child.kill("SIGTERM"), setTimeout(() => {
				try {
					t.child.kill("SIGKILL");
				} catch {}
			}, 1500), n += 1;
		} catch {}
	}
	return {
		ok: n > 0,
		killed: n
	};
}
async function A(e) {
	let t = (e.command || "").trim();
	if (!t) return {
		ok: !1,
		code: 1,
		stdout: "",
		stderr: "empty command"
	};
	let n = Math.min(Math.max(e.timeoutMs || 6e4, 1e3), 6e5), r = e.cwd && d.isAbsolute(e.cwd) ? e.cwd : process.cwd(), i = process.platform === "win32" ? "cmd.exe" : "/bin/bash", a = process.platform === "win32" ? ["/c", t] : ["-lc", t], o = e.runId || ne();
	return new Promise((t) => {
		let s = "", c = "", l = !1, u = p(i, a, {
			cwd: r,
			env: {
				...process.env,
				...e.env || {},
				HOME: m.homedir()
			},
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		k.set(o, {
			child: u,
			tag: e.tag
		});
		let d = (e) => {
			l || (l = !0, clearTimeout(f), k.delete(o), t({
				...e,
				runId: o
			}));
		}, f = setTimeout(() => {
			try {
				u.kill("SIGTERM"), setTimeout(() => u.kill("SIGKILL"), 1500);
			} catch {}
			d({
				ok: !1,
				code: null,
				stdout: s.slice(0, 8e4),
				stderr: (c + "\n[timeout]").slice(0, 2e4),
				timedOut: !0
			});
		}, n);
		u.stdout?.on("data", (e) => {
			s += e.toString("utf-8"), s.length > 1e5 && (s = s.slice(-8e4));
		}), u.stderr?.on("data", (e) => {
			c += e.toString("utf-8"), c.length > 4e4 && (c = c.slice(-2e4));
		}), u.on("error", (e) => {
			d({
				ok: !1,
				code: 1,
				stdout: s,
				stderr: e.message
			});
		}), u.on("close", (e, t) => {
			let n = t === "SIGTERM" || t === "SIGKILL";
			d({
				ok: e === 0,
				code: e,
				stdout: s.slice(0, 8e4),
				stderr: n ? (c + "\n[cancelled]").slice(0, 2e4) : c.slice(0, 2e4),
				cancelled: n && e !== 0
			});
		});
	});
}
//#endregion
//#region electron/opencodeBridge.ts
function je(e) {
	return e.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
function Me(e) {
	try {
		if (!f.existsSync(e)) return null;
		let t = f.readFileSync(e, "utf-8");
		return JSON.parse(je(t));
	} catch {
		return null;
	}
}
function Ne(e) {
	let t = e.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!t) return {
		data: {},
		body: e
	};
	let n = t[1].split(/\r?\n/), r = {}, i = 0;
	for (; i < n.length;) {
		let e = n[i];
		if (!e.trim() || e.trim().startsWith("#")) {
			i++;
			continue;
		}
		if ((e.match(/^(\s*)/)?.[1].length || 0) > 0) {
			i++;
			continue;
		}
		let t = e.indexOf(":");
		if (t < 0) {
			i++;
			continue;
		}
		let a = e.slice(0, t).trim(), o = e.slice(t + 1).trim();
		if (!o) {
			let e = {};
			for (i++; i < n.length;) {
				let t = n[i], r = t.match(/^(\s*)/)?.[1].length || 0;
				if (!t.trim()) {
					i++;
					continue;
				}
				if (r === 0) break;
				let a = t.trim(), o = a.indexOf(":");
				if (o < 0) {
					i++;
					continue;
				}
				let s = a.slice(0, o).trim().replace(/^["']|["']$/g, ""), c = a.slice(o + 1).trim();
				if (c === "") {
					let t = {};
					for (i++; i < n.length;) {
						let e = n[i], a = e.match(/^(\s*)/)?.[1].length || 0;
						if (!e.trim() || a <= r) break;
						let o = e.trim(), s = o.indexOf(":");
						if (s < 0) {
							i++;
							continue;
						}
						let c = o.slice(0, s).trim().replace(/^["']|["']$/g, ""), l = o.slice(s + 1).trim();
						typeof l == "string" && /^["'].*["']$/.test(l) && (l = l.slice(1, -1)), t[c] = l, i++;
					}
					e[s] = t;
					continue;
				}
				c === "true" ? c = !0 : c === "false" ? c = !1 : typeof c == "string" && /^["'].*["']$/.test(c) && (c = c.slice(1, -1)), e[s] = c, i++;
			}
			r[a] = e;
			continue;
		}
		let s = o;
		s === "true" ? s = !0 : s === "false" ? s = !1 : typeof s == "string" && /^["'].*["']$/.test(s) ? s = s.slice(1, -1) : typeof s == "string" && /^-?\d+(\.\d+)?$/.test(s) && (s = Number(s)), r[a] = s, i++;
	}
	return {
		data: r,
		body: t[2] || ""
	};
}
function Pe(e, t) {
	if (!f.existsSync(e)) return [];
	let n = [], r;
	try {
		r = f.readdirSync(e).filter((e) => e.endsWith(".md"));
	} catch {
		return [];
	}
	for (let i of r) {
		let r = d.join(e, i);
		try {
			let { data: e, body: a } = Ne(f.readFileSync(r, "utf-8")), o = i.replace(/\.md$/, "");
			n.push({
				id: o,
				name: String(e.name || o),
				path: r,
				mode: e.mode == null ? void 0 : String(e.mode),
				description: e.description == null ? void 0 : String(e.description),
				model: e.model == null ? void 0 : String(e.model),
				temperature: typeof e.temperature == "number" ? e.temperature : e.temperature == null ? void 0 : Number(e.temperature),
				steps: typeof e.steps == "number" ? e.steps : e.maxSteps == null ? void 0 : Number(e.maxSteps),
				hidden: e.hidden === !0,
				color: e.color == null ? void 0 : String(e.color),
				body: a.trim(),
				permission: e.permission && typeof e.permission == "object" ? e.permission : void 0,
				frontmatter: e,
				source: t
			});
		} catch {}
	}
	return n;
}
function Fe(e, t) {
	if (!f.existsSync(e)) return [];
	let n = [], r;
	try {
		r = f.readdirSync(e).filter((e) => e.endsWith(".md"));
	} catch {
		return [];
	}
	for (let i of r) {
		let r = d.join(e, i);
		try {
			let { data: e, body: a } = Ne(f.readFileSync(r, "utf-8")), o = i.replace(/\.md$/, "");
			n.push({
				id: o,
				name: String(e.name || o),
				path: r,
				description: e.description == null ? void 0 : String(e.description),
				template: a.trim() || String(e.template || ""),
				agent: e.agent == null ? void 0 : String(e.agent),
				model: e.model == null ? void 0 : String(e.model),
				source: t
			});
		} catch {}
	}
	return n;
}
function j(e) {
	let t = m.homedir(), n = [d.join(t, ".config", "opencode", "agents"), d.join(t, ".opencode", "agents")], r = e ? [d.join(e, ".opencode", "agents"), d.join(e, "opencode", "agents")] : [], i = n.flatMap((e) => Pe(e, "global")), a = r.flatMap((e) => Pe(e, "project")), o = null;
	for (let e of [d.join(t, ".config", "opencode", "opencode.json"), d.join(t, ".config", "opencode", "opencode.jsonc")]) if (f.existsSync(e)) {
		o = e;
		break;
	}
	return {
		global: i,
		project: a,
		dirs: [...n, ...r],
		configHint: o
	};
}
function Ie(e) {
	let t = m.homedir(), n = (e || "").trim(), r = [
		d.join(t, ".config", "opencode", "opencode.json"),
		d.join(t, ".config", "opencode", "opencode.jsonc"),
		d.join(t, ".opencode", "opencode.json"),
		d.join(t, ".opencode", "opencode.jsonc")
	];
	n && r.push(d.join(n, "opencode.json"), d.join(n, "opencode.jsonc"), d.join(n, ".opencode", "opencode.json"), d.join(n, ".opencode", "opencode.jsonc"));
	let i = [], a = [];
	for (let e of r) {
		let t = Me(e);
		t && (i.push({
			path: e,
			data: t
		}), a.push(e));
	}
	let o = j(n || void 0), s = [...o.global, ...o.project], c = [d.join(t, ".config", "opencode", "commands"), d.join(t, ".opencode", "commands")], l = n ? [d.join(n, ".opencode", "commands"), d.join(n, "opencode", "commands")] : [];
	return {
		layers: i,
		agents: s,
		commands: [...c.flatMap((e) => Fe(e, "global")), ...l.flatMap((e) => Fe(e, "project"))],
		sources: a
	};
}
async function Le() {
	let e = process.platform === "win32" ? [
		"opencode.cmd",
		"opencode.exe",
		"opencode"
	] : ["opencode"];
	for (let t of e) {
		let e = await A({
			command: process.platform === "win32" ? `where ${t}` : `command -v ${t}`,
			timeoutMs: 5e3
		});
		if (e.ok && e.stdout.trim()) {
			let t = e.stdout.trim().split(/\r?\n/)[0], n = await A({
				command: `"${t}" --version`,
				timeoutMs: 8e3
			});
			return {
				found: !0,
				path: t,
				version: n.stdout.trim() || n.stderr.trim() || null
			};
		}
	}
	return {
		found: !1,
		path: null,
		version: null
	};
}
async function Re(e) {
	let t = await Le();
	if (!t.found || !t.path) return {
		ok: !1,
		output: "",
		error: "opencode CLI 未安裝或不在 PATH"
	};
	let n = e.prompt.replace(/"/g, "\\\"").slice(0, 4e3), r = await A({
		command: `"${t.path}" run ${JSON.stringify(e.prompt).slice(0, 4100)} 2>&1 || "${t.path}" ${JSON.stringify(n)} 2>&1`,
		cwd: e.cwd,
		timeoutMs: e.timeoutMs || 12e4
	}), i = (r.stdout || r.stderr || "").slice(0, 5e4);
	return {
		ok: r.ok,
		output: i || "(empty)",
		error: r.ok ? void 0 : r.stderr || `exit ${r.code}`
	};
}
function ze(e) {
	return {
		ok: !1,
		message: "互動式 opencode TUI 請在系統終端執行 `opencode`。本 App 支援 agents/*.md 掃描、opencode.json 合併與一次性 CLI 呼叫。"
	};
}
//#endregion
//#region electron/projectBridge.ts
async function Be(t, n) {
	let r = {
		properties: ["openDirectory", "createDirectory"],
		title: "選擇專案目錄",
		buttonLabel: "選擇此資料夾",
		defaultPath: n && f.existsSync(n) && n || i.getPath("home")
	};
	try {
		let n = (t && !t.isDestroyed() ? t : null) || e.getFocusedWindow() || e.getAllWindows().find((e) => !e.isDestroyed()) || null;
		n && !n.isDestroyed() && (n.isMinimized() && n.restore(), n.isVisible() || n.show(), n.focus(), await new Promise((e) => setTimeout(e, 30)));
		let i;
		try {
			i = n ? await a.showOpenDialog(n, r) : await a.showOpenDialog(r);
		} catch (e) {
			console.warn("[project:pick] modal dialog failed, retrying free-standing:", e), i = await a.showOpenDialog(r);
		}
		if (i.canceled || !i.filePaths?.[0]) return {
			canceled: !0,
			path: null
		};
		let o = i.filePaths[0];
		if (!f.existsSync(o)) return {
			canceled: !1,
			path: null,
			error: `路徑不存在：${o}`
		};
		let s;
		try {
			s = f.statSync(o);
		} catch (e) {
			return {
				canceled: !1,
				path: null,
				error: e instanceof Error ? e.message : String(e)
			};
		}
		return s.isDirectory() ? {
			canceled: !1,
			path: o
		} : {
			canceled: !1,
			path: null,
			error: `不是資料夾：${o}`
		};
	} catch (e) {
		return console.error("[project:pick] failed:", e), {
			canceled: !1,
			path: null,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}
async function Ve(e) {
	let t = d.basename(e) || e;
	if (!e || !f.existsSync(e)) return {
		root: e || "",
		name: t || "—",
		isGit: !1,
		branch: null,
		remote: null,
		worktrees: [],
		dirty: !1
	};
	let n = await A({
		command: "git rev-parse --is-inside-work-tree",
		cwd: e,
		timeoutMs: 5e3
	});
	if (!(n.ok && n.stdout.trim() === "true")) return {
		root: e,
		name: t,
		isGit: !1,
		branch: null,
		remote: null,
		worktrees: [],
		dirty: !1
	};
	let r = (await A({
		command: "git rev-parse --abbrev-ref HEAD",
		cwd: e,
		timeoutMs: 5e3
	})).stdout.trim() || null, i = (await A({
		command: "git remote get-url origin",
		cwd: e,
		timeoutMs: 5e3
	})).stdout.trim() || null, a = !!(await A({
		command: "git status --porcelain",
		cwd: e,
		timeoutMs: 8e3
	})).stdout.trim(), o = He((await A({
		command: "git worktree list --porcelain",
		cwd: e,
		timeoutMs: 8e3
	})).stdout);
	return {
		root: e,
		name: t,
		isGit: !0,
		branch: r === "HEAD" ? "detached" : r,
		remote: i,
		worktrees: o.length ? o : [{
			path: e,
			branch: r || "main",
			bare: !1,
			detached: r === "HEAD"
		}],
		dirty: a
	};
}
function He(e) {
	let t = e.trim().split(/\n\n+/), n = [];
	for (let e of t) {
		let t = e.split("\n"), r = "", i = "", a = !1, o = !1;
		for (let e of t) e.startsWith("worktree ") ? r = e.slice(9) : e.startsWith("branch ") ? i = e.slice(7).replace(/^refs\/heads\//, "") : e === "bare" ? a = !0 : (e === "detached" || e.startsWith("HEAD ") && !i) && (o = !0);
		r && n.push({
			path: r,
			branch: i || (o ? "detached" : "main"),
			bare: a,
			detached: o
		});
	}
	return n;
}
async function Ue(e) {
	let t = await A({
		command: "git branch --format=\"%(refname:short)\"",
		cwd: e,
		timeoutMs: 8e3
	});
	return t.ok ? t.stdout.split("\n").map((e) => e.trim()).filter(Boolean).slice(0, 40) : [];
}
//#endregion
//#region electron/cliDiscover.ts
var M = [
	"fast",
	"standard",
	"deep",
	"max",
	"ultra"
];
function N(...e) {
	return d.join(m.homedir(), ...e);
}
function P(e) {
	try {
		return f.existsSync(e);
	} catch {
		return !1;
	}
}
function F(e) {
	try {
		let t = f.readFileSync(e, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		return JSON.parse(t);
	} catch {
		return null;
	}
}
function We(e) {
	let t = e.toLowerCase();
	return t === "low" || t === "minimal" || t === "xlow" || t === "fast" ? "fast" : t === "medium" || t === "mid" || t === "default" || t === "normal" ? "standard" : t === "high" ? "deep" : t === "xhigh" || t === "extra_high" || t === "extra-high" ? "max" : t === "max" || t === "ultra" || t === "maximum" ? "ultra" : null;
}
function Ge(e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) {
		let e = We(typeof n == "string" ? n : n.effort || "");
		e && t.add(e);
	}
	return t.size ? [...t] : M;
}
async function I(e) {
	let t = [
		e,
		N(".grok", "bin", e),
		N(".local", "bin", e),
		N(".npm-global", "bin", e),
		`/usr/local/bin/${e}`,
		`/opt/homebrew/bin/${e}`
	];
	for (let e of t) if ((e.includes("/") || e.includes("\\")) && P(e) && f.statSync(e).isFile()) return e;
	let n = await A({
		command: process.platform === "win32" ? `where ${e}` : `command -v ${e}`,
		timeoutMs: 4e3
	}), r = n.stdout.trim().split(/\r?\n/)[0];
	return n.ok && r ? r : null;
}
function Ke() {
	let e = N(".codex", "models_cache.json"), t = N(".codex", "config.toml"), n = [];
	if (P(e)) {
		let t = F(e);
		for (let e of t?.models || []) e.slug && n.push({
			id: e.slug,
			label: e.display_name || e.slug,
			depths: Ge(e.supported_reasoning_levels || []),
			rawEfforts: (e.supported_reasoning_levels || []).map((e) => e.effort || "").filter(Boolean)
		});
	}
	let r, i;
	if (P(t)) try {
		let e = f.readFileSync(t, "utf-8"), n = e.match(/^\s*model\s*=\s*"([^"]+)"/m), a = e.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m);
		n && (r = n[1]), a && (i = We(a[1]) || a[1]);
	} catch {}
	return {
		models: n,
		defaultModel: r,
		defaultDepth: i
	};
}
function qe() {
	let e = N(".grok", "models_cache.json");
	if (!P(e)) return [];
	let t = F(e), n = [], r = t?.models;
	if (!r || typeof r != "object") return [];
	for (let e of Object.keys(r)) n.push({
		id: e,
		label: e,
		depths: M
	});
	return n;
}
function Je(e, t) {
	if (t?.trim()) return t.trim();
	let n = {
		sonnet: "Sonnet (latest)",
		opus: "Opus (latest)",
		haiku: "Haiku (latest)",
		fable: "Fable (latest)",
		best: "Best available"
	};
	if (n[e]) return n[e];
	let r = e.replace(/^claude-/, ""), i = /\[1m\]/i.test(r);
	r = r.replace(/\[1m\]/gi, ""), r = r.replace(/-(\d{8})(?:-v\d+)?$/, ""), r = r.replace(/-v\d+$/, "");
	let a = r.split("-").filter(Boolean);
	if (a.length) {
		let e = a[0].charAt(0).toUpperCase() + a[0].slice(1), t = a.slice(1).join(".");
		return `${e}${t ? ` ${t}` : ""}${i ? " (1M)" : ""}`;
	}
	return e;
}
function Ye(e) {
	let t = e.trim();
	return !t || t.length > 80 || /\.(md|json|js|ts)$/i.test(t) || /[\/\\]/.test(t) || /mythos/i.test(t) ? !1 : /^(sonnet|opus|haiku|fable|best)$/i.test(t) ? !0 : /^claude-(opus|sonnet|haiku|fable)(-[a-z0-9.]+)+(?:\[[^\]]+\])?$/i.test(t) ? !(t.endsWith("-") || t.endsWith(".") || !/\d/.test(t)) : !1;
}
function Xe(e) {
	let t = /* @__PURE__ */ new Map(), n = (e, n) => {
		let r = (e || "").trim();
		if (!r || !Ye(r)) return;
		let i = t.get(r), a = Je(r, n);
		i ? n && i.label === i.id && t.set(r, {
			...i,
			label: a
		}) : t.set(r, {
			id: r,
			label: a,
			depths: M
		});
	}, r = [
		N(".claude", "settings.json"),
		N(".claude", "settings.local.json"),
		N(".config", "claude", "settings.json")
	];
	for (let e of r) {
		if (!P(e)) continue;
		let t = F(e);
		if (t && (n(t.model), n(t.defaultModel), Array.isArray(t.models))) for (let e of t.models) typeof e == "string" ? n(e) : e && typeof e == "object" && n(e.id || e.model || e.name, e.label || e.name);
	}
	let i = N(".claude.json");
	if (P(i)) {
		let e = F(i);
		if (e) {
			typeof e.model == "string" && n(e.model), typeof e.defaultModel == "string" && n(e.defaultModel), typeof e.orgModelDefaultCache == "string" && n(e.orgModelDefaultCache);
			let t = e.additionalModelOptionsCache;
			if (Array.isArray(t)) for (let e of t) {
				if (!e || typeof e != "object") continue;
				let t = e;
				n(t.value, t.label || t.description);
			}
			let r = e.modelAccessCache;
			if (Array.isArray(r)) {
				for (let e of r) if (typeof e == "string") n(e);
				else if (e && typeof e == "object") {
					let t = e;
					n(t.id || t.model || t.value, t.label);
				}
			}
			let i = e.projects;
			if (i && typeof i == "object") for (let e of Object.values(i)) e?.model && n(e.model);
		}
	}
	try {
		let e = N(".claude", "history.jsonl");
		if (P(e)) {
			let t = f.readFileSync(e, "utf-8"), r = /"model"\s*:\s*"([^"]+)"/g, i;
			for (; i = r.exec(t);) n(i[1]);
		}
	} catch {}
	try {
		let e = N(".claude", "sessions");
		if (P(e)) for (let t of f.readdirSync(e).slice(0, 40)) {
			if (!t.endsWith(".json")) continue;
			let r = F(d.join(e, t));
			r?.model && n(r.model);
		}
	} catch {}
	let a = Ze(e);
	for (let e of a) n(e.id, e.label);
	if (e || t.size) for (let r of [
		"sonnet",
		"opus",
		"haiku",
		"fable"
	]) ([...t.keys()].some((e) => e === r || e.toLowerCase().includes(`claude-${r}`) || e.toLowerCase().includes(`${r}-`)) || e) && n(r);
	let o = [...t.values()];
	return o.sort((e, t) => {
		let n = (e) => /^(sonnet|opus|haiku|fable)$/i.test(e) ? 0 : /\[\d+m\]/i.test(e) ? 1 : /-\d{8}/.test(e) ? 3 : /-v\d+$/.test(e) ? 2 : 1, r = n(e.id) - n(t.id);
		return r === 0 ? e.id.localeCompare(t.id) : r;
	}), o;
}
function Ze(e) {
	if (!e || !P(e)) return [];
	let t = e;
	try {
		t = f.realpathSync(e);
	} catch {}
	try {
		let e = f.statSync(t);
		if (!e.isFile() || e.size > 250 * 1024 * 1024) return [];
		let n = f.readFileSync(t), r = /claude-(?:opus|sonnet|haiku|fable)(?:-[a-z0-9.]+)*(?:\[[0-9]+m\])?/gi, i = /* @__PURE__ */ new Set(), a = n.toString("latin1"), o;
		for (; o = r.exec(a);) {
			let e = o[0];
			Ye(e) && (/-\d{8}/.test(e) || /-v\d+$/i.test(e) || e.endsWith("-fast") || i.add(e));
		}
		return [...i].map((e) => ({
			id: e,
			label: Je(e),
			depths: M
		}));
	} catch {
		return [];
	}
}
function Qe() {
	let e = [
		N(".config", "opencode", "opencode.jsonc"),
		N(".config", "opencode", "opencode.json"),
		N(".opencode", "opencode.json")
	], t = null, n = null;
	for (let r of e) if (P(r)) {
		t = r, n = F(r);
		break;
	}
	let r = [];
	if (n) {
		typeof n.model == "string" && r.push({
			id: n.model,
			label: n.model,
			depths: M
		});
		let e = n.provider;
		if (e && typeof e == "object") for (let [t, n] of Object.entries(e)) {
			let e = n?.models;
			if (e && typeof e == "object") for (let n of Object.keys(e)) r.push({
				id: `${t}/${n}`,
				label: `${t}/${n}`,
				depths: M
			});
		}
	}
	try {
		let e = j();
		for (let t of [...e.global, ...e.project]) t.model && r.push({
			id: t.model,
			label: t.model,
			depths: M
		});
	} catch {}
	let i = /* @__PURE__ */ new Set();
	return {
		models: r.filter((e) => i.has(e.id) ? !1 : (i.add(e.id), !0)),
		path: t
	};
}
function $e() {
	let e = N(".codex", "auth.json");
	if (!P(e)) return !1;
	try {
		let t = F(e);
		if (t?.tokens || t?.OPENAI_API_KEY) return !0;
	} catch {}
	return P(e);
}
function et() {
	return P(N(".grok", "auth.json"));
}
function tt() {
	return P(N(".claude")) || P(N(".config", "claude")) || !!process.env.ANTHROPIC_API_KEY;
}
async function nt() {
	let e = [];
	{
		let t = await I("codex"), { models: n, defaultModel: r, defaultDepth: i } = Ke(), a = [
			N(".codex", "auth.json"),
			N(".codex", "config.toml"),
			N(".codex", "models_cache.json")
		].filter(P), o = $e();
		e.push({
			id: "codex",
			kind: "codex",
			name: "Codex CLI",
			foundBinary: !!t,
			binaryPath: t,
			configPaths: a,
			hasAuth: o,
			authNote: o ? "偵測到 ~/.codex 登入狀態（ChatGPT/OAuth）。本 App 不會複製 token；可匯入模型清單。" : "未偵測到 Codex 登入",
			models: n,
			defaultModel: r,
			defaultDepth: i,
			notes: [t ? `binary: ${t}` : "PATH 中無 codex（可能仍可用本機設定目錄）", n.length ? `models_cache: ${n.length} 個模型` : "無 models_cache.json"]
		});
	}
	{
		let t = await I("claude") || await I("claude-code"), n = [
			N(".claude"),
			N(".claude.json"),
			N(".config", "claude")
		].filter(P), r = tt(), i = Xe(t);
		e.push({
			id: "anthropic",
			kind: "anthropic",
			name: "Claude Code",
			foundBinary: !!t,
			binaryPath: t,
			configPaths: n,
			hasAuth: r,
			authNote: r ? "偵測到 Claude 設定目錄。需本機已 login；本 App 不讀取 secret 檔。" : "未偵測到 Claude 設定",
			models: i,
			defaultModel: i.find((e) => e.id.startsWith("claude-") && !/-\d{8}/.test(e.id))?.id,
			notes: [
				t ? `binary: ${t}` : "PATH 中無 claude",
				`config: ${n.map((e) => d.basename(e)).join(", ") || "none"}`,
				i.length ? `discovered models: ${i.length}（含 settings / additionalModelOptionsCache / binary）` : "無本機模型可匯入 — 請先在 Claude Code 登入或選過模型"
			]
		});
	}
	{
		let t = await I("grok") || (P(N(".grok", "bin", "grok")) ? N(".grok", "bin", "grok") : null), n = qe(), r = et();
		e.push({
			id: "grok",
			kind: "custom",
			name: "Grok CLI",
			foundBinary: !!t,
			binaryPath: t,
			configPaths: [N(".grok", "auth.json"), N(".grok", "models_cache.json")].filter(P),
			hasAuth: r,
			authNote: r ? "偵測到 ~/.grok 登入。本 App 不複製 token；可匯入模型 id。" : "未偵測到 Grok 登入",
			models: n,
			notes: [t ? `binary: ${t}` : "無 grok binary", n.length ? `models_cache: ${n.length}` : "無 models_cache 可匯入"]
		});
	}
	{
		let t = await I("opencode"), { models: n, path: r } = Qe(), i = j();
		e.push({
			id: "opencode",
			kind: "opencode",
			name: "OpenCode CLI",
			foundBinary: !!t,
			binaryPath: t,
			configPaths: [r, ...i.dirs].filter(Boolean),
			hasAuth: !!(t || r || i.global.length),
			authNote: r ? `已找到 ${r}（可匯入模型）` : "未找到 opencode.jsonc",
			models: n,
			notes: [
				t ? `binary: ${t}` : "PATH 無 opencode",
				`agents.md: ${i.global.length + i.project.length}`,
				n.length ? `discovered models: ${n.length}` : "設定中無模型可匯入"
			]
		});
	}
	{
		let t = await I("cursor-agent") || await I("cursor");
		e.push({
			id: "cursor",
			kind: "cursor",
			name: "Cursor CLI",
			foundBinary: !!t,
			binaryPath: t,
			configPaths: [],
			hasAuth: !!t,
			authNote: t ? "偵測到 Cursor binary（模型請手輸或由 CLI 預設）" : "未安裝 cursor-agent",
			models: [],
			notes: [t ? `binary: ${t}` : "無 binary"]
		});
	}
	let t = e.filter((e) => e.foundBinary || e.hasAuth);
	return {
		clis: e,
		summary: [`已掃描 ${e.length} 個 CLI 來源，${t.length} 個可授權`, ...t.map((e) => `· ${e.name}: binary=${e.foundBinary ? "yes" : "no"} auth=${e.hasAuth} models=${e.models.length}`)].join("\n")
	};
}
function rt(e, t) {
	let n = new Map(e.map((e) => [String(e.id), { ...e }]));
	for (let e of t) {
		let t = n.get(e.id) || {
			id: e.id,
			kind: e.kind,
			name: e.name,
			enabled: !1,
			authorized: !1,
			models: []
		}, r = e.models.map((e) => ({
			id: e.id,
			label: e.label,
			depths: e.depths
		}));
		n.set(e.id, {
			...t,
			name: e.name,
			kind: e.kind,
			cliBinary: e.binaryPath || t.cliBinary || e.id,
			enabled: !!t.enabled || e.foundBinary || e.hasAuth,
			authorized: !!t.authorized || e.hasAuth || e.foundBinary,
			models: r
		});
	}
	return [.../* @__PURE__ */ new Set([...e.map((e) => String(e.id)), ...t.map((e) => e.id)])].map((e) => n.get(e)).filter(Boolean);
}
//#endregion
//#region electron/mcpDiscover.ts
function it(e) {
	try {
		let t = f.readFileSync(e, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		return JSON.parse(t);
	} catch {
		return null;
	}
}
function at(e, t) {
	let n = `mcp_${e.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 36) || "server"}`, r = n, i = 2;
	for (; t.has(r);) r = `${n}_${i++}`;
	return t.add(r), r;
}
function ot(e) {
	let t = m.homedir(), n = process.env.APPDATA || d.join(t, "AppData", "Roaming"), r = [
		d.join(t, ".claude", "claude_desktop_config.json"),
		d.join(t, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
		d.join(n, "Claude", "claude_desktop_config.json"),
		e ? d.join(e, ".mcp.json") : "",
		e ? d.join(e, "opencode.jsonc") : "",
		d.join(t, ".config", "opencode", "opencode.jsonc")
	].filter(Boolean), i = [], a = /* @__PURE__ */ new Set(), o = [];
	for (let e of r) {
		let t = it(e);
		if (!t) continue;
		let n = t.mcpServers || t.mcp;
		if (!(!n || typeof n != "object")) {
			o.push(e);
			for (let [e, t] of Object.entries(n)) {
				if (!t || typeof t != "object") continue;
				let n = t, r = typeof n.url == "string" ? n.url : "", o = typeof n.command == "string" ? n.command : "", s = Array.isArray(n.args) ? n.args.filter((e) => typeof e == "string") : [];
				!r && !o || i.push({
					id: at(e, a),
					name: e,
					enabled: !0,
					transport: r ? "http" : "stdio",
					...r ? { url: r } : {
						command: o,
						args: s
					}
				});
			}
		}
	}
	return {
		servers: i,
		sources: o
	};
}
//#endregion
//#region electron/ptyBridge.ts
var L = /* @__PURE__ */ new Map();
function st() {
	if (process.platform === "win32") return {
		file: process.env.COMSPEC || "cmd.exe",
		args: []
	};
	let e = process.env.SHELL || "/bin/bash";
	return {
		file: e,
		args: e.endsWith("zsh") || e.endsWith("bash") ? ["-i"] : []
	};
}
function ct() {
	return [...L.values()].map((e) => ({
		id: e.id,
		title: e.title,
		cwd: e.cwd,
		alive: e.alive && !e.child.killed,
		createdAt: e.createdAt
	}));
}
function lt(e) {
	let t = `term_${ne().slice(0, 8)}`, n = e.cwd && d.isAbsolute(e.cwd) ? e.cwd : process.cwd(), { file: r, args: i } = st(), a = p(r, i, {
		cwd: n,
		env: {
			...process.env,
			TERM: process.env.TERM || "xterm-256color",
			HOME: m.homedir()
		},
		stdio: [
			"pipe",
			"pipe",
			"pipe"
		]
	}), o = {
		id: t,
		title: e.title || `Shell ${L.size + 1}`,
		cwd: n,
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		child: a,
		alive: !0,
		webContents: e.webContents || null
	};
	L.set(t, o);
	let s = (e, n) => {
		let r = o.webContents;
		r && !r.isDestroyed() && r.send("term:data", {
			id: t,
			stream: n,
			data: e
		});
	};
	return a.stdout.on("data", (e) => s(e.toString("utf-8"), "stdout")), a.stderr.on("data", (e) => s(e.toString("utf-8"), "stderr")), a.on("close", (e) => {
		o.alive = !1, s(`\r\n[exit ${e}]\r\n`, "stdout");
		let n = o.webContents;
		n && !n.isDestroyed() && n.send("term:exit", {
			id: t,
			code: e
		});
	}), a.on("error", (e) => {
		o.alive = !1, s(`\r\n[error ${e.message}]\r\n`, "stderr");
	}), setTimeout(() => {
		s(`# SubAgents terminal · ${n}\r\n`, "stdout");
	}, 50), {
		id: o.id,
		title: o.title,
		cwd: o.cwd,
		alive: !0,
		createdAt: o.createdAt
	};
}
function ut(e, t) {
	let n = L.get(e);
	if (!n || !n.alive) return {
		ok: !1,
		error: "session not alive"
	};
	try {
		return n.child.stdin.write(t), { ok: !0 };
	} catch (e) {
		return {
			ok: !1,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}
function dt(e) {
	let t = L.get(e);
	if (!t) return { ok: !1 };
	try {
		t.child.kill();
	} catch {}
	return t.alive = !1, L.delete(e), { ok: !0 };
}
function ft() {
	for (let e of [...L.keys()]) dt(e);
}
function pt(e, t) {
	let n = L.get(e);
	n && (n.webContents = t);
}
//#endregion
//#region src/agent/cliApproval.ts
function mt(e, t, n, r) {
	let i = t || "auto";
	return i === "full" && n ? {
		mode: "auto",
		permissive: !1,
		note: "無人值守任務：完整存取權降級為 CLI 預設核准"
	} : i === "full" ? r === "plan" ? {
		mode: "auto",
		permissive: !1,
		note: "Plan mode 優先，保留 CLI plan 權限限制"
	} : e === "codex" || e === "claude" ? {
		mode: "full",
		permissive: !0,
		note: "互動完整存取權：已映射 CLI permissive flag"
	} : {
		mode: "auto",
		permissive: !1,
		note: `${e} 未宣告穩定 permissive flag，保留 CLI 預設核准`
	} : {
		mode: i,
		permissive: !1,
		note: "CLI 使用其預設互動核准"
	};
}
//#endregion
//#region electron/localCliRunner.ts
function R(e) {
	return process.platform === "win32" ? `"${e.replace(/%/g, "%%").replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\*)$/g, "$1$1")}"` : `'${e.replace(/'/g, "'\\''")}'`;
}
function ht(e) {
	switch (e) {
		case "fast": return "low";
		case "standard": return "medium";
		case "deep": return "high";
		case "max": return "xhigh";
		case "ultra": return "max";
		default: return "high";
	}
}
function gt(e, t) {
	if (t && t.trim()) return t.trim();
	switch (e) {
		case "claude": return "claude";
		case "codex": return "codex";
		case "grok": return "grok";
		case "opencode": return "opencode";
		case "cursor": return "cursor-agent";
		default: return e;
	}
}
function _t(e) {
	let t = gt(e.kind, e.binary), n = R(e.prompt.slice(0, 12e3)), r = e.model?.trim(), i = ht(e.depth), a = e.agentMode === "plan", o = mt(e.kind, e.approvalMode, e.unattended, e.agentMode), s = R(t);
	switch (e.kind) {
		case "codex": {
			let e = r ? `--model ${R(r)}` : "", t = `--config model_reasoning_effort=${R(i)}`, a = o.permissive ? "--full-auto" : "";
			return [
				`${s} exec ${a} ${e} ${t} ${n}`,
				`${s} ${a} ${e} -q ${n}`,
				`${s} ${e} ${n}`
			].map((e) => `(${e})`).join(" || ");
		}
		case "claude": {
			let e = r ? `--model ${R(r)}` : "";
			return `${s} -p ${e} ${a ? "--permission-mode plan" : o.permissive ? "--dangerously-skip-permissions" : ""} ${n}${o.permissive ? ` || ${s} -p ${e} ${n}` : ""}`;
		}
		case "grok": return `${s} ${r ? `--model ${R(r)}` : ""} ${n}`;
		case "opencode": return [`${s} run ${r ? `--model ${R(r)}` : ""} ${n}`, `${s} ${n}`].map((e) => `(${e})`).join(" || ");
		case "cursor": return [`${s} -p ${n}`, `${s} ${n}`].map((e) => `(${e})`).join(" || ");
		default: return `${s} ${n}`;
	}
}
async function vt(e, t) {
	if (d.isAbsolute(t)) return (await A({
		command: process.platform === "win32" ? `if exist ${R(t)} (echo OK) else (exit 1)` : `test -x ${R(t)} || test -f ${R(t)}`,
		timeoutMs: 5e3,
		tag: "cli-preflight"
	})).ok ? {
		ok: !0,
		path: t
	} : {
		ok: !1,
		path: null,
		error: `找不到可執行檔：${t}（請在設定中授權並掃描 CLI，或安裝 ${e}）`
	};
	let n = await A({
		command: process.platform === "win32" ? `where ${t}` : `command -v ${R(t)}`,
		timeoutMs: 5e3,
		tag: "cli-preflight"
	}), r = n.stdout.trim().split(/\r?\n/)[0] || null;
	return !n.ok || !r ? {
		ok: !1,
		path: null,
		error: `PATH 中找不到 \`${t}\`（kind=${e}）。請安裝 CLI、確認 PATH，並在設定 → 掃描本機 CLI。`
	} : {
		ok: !0,
		path: r
	};
}
async function yt(e) {
	let t = e.kind, n = gt(t, e.binary), r = e.runId || ne(), i = e.cwd && d.isAbsolute(e.cwd) ? e.cwd : void 0, a = e.timeoutMs || 3e5, o = await vt(t, n);
	if (!o.ok) return {
		ok: !1,
		output: "",
		command: n,
		kind: t,
		code: 127,
		error: o.error,
		runId: r
	};
	let s = _t({
		...e,
		binary: o.path || n
	}), c = await A({
		command: s,
		cwd: i,
		timeoutMs: a,
		runId: r,
		tag: "cli-agent"
	}), l = [c.stdout, c.stderr].filter(Boolean).join("\n\n").trim(), u = !!c.cancelled;
	return {
		ok: c.ok,
		output: l.slice(0, 1e5) || (c.ok ? "(empty output)" : u ? "已取消" : "CLI 無輸出"),
		command: s,
		kind: t,
		code: c.code,
		timedOut: c.timedOut,
		cancelled: u,
		error: c.ok ? void 0 : u ? "使用者取消" : c.timedOut ? "逾時" : c.stderr || `exit ${c.code}`,
		runId: r
	};
}
//#endregion
//#region electron/codegraphBridge.ts
function z(e) {
	return process.platform === "win32" ? `"${e.replace(/%/g, "%%").replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\*)$/g, "$1$1")}"` : `'${e.replace(/'/g, "'\\''")}'`;
}
async function bt() {
	let e = await A({
		command: process.platform === "win32" ? "where codegraph" : "command -v codegraph",
		timeoutMs: 5e3,
		tag: "codegraph"
	}), t = e.stdout.trim().split(/\r?\n/)[0] || null;
	return e.ok && t ? t : null;
}
function xt(e) {
	let t = e.trim();
	if (!t) return;
	try {
		return JSON.parse(t);
	} catch {}
	let n = Math.min(...[t.indexOf("{"), t.indexOf("[")].filter((e) => e >= 0));
	if (!Number.isFinite(n) || n < 0) return;
	let r = t.slice(n);
	try {
		return JSON.parse(r);
	} catch {
		return;
	}
}
async function B() {
	let e = await bt();
	if (!e) return {
		installed: !1,
		binaryPath: null,
		version: null
	};
	let t = await A({
		command: `${z(e)} --version`,
		timeoutMs: 8e3,
		tag: "codegraph"
	});
	return t.ok || (t = await A({
		command: `${z(e)} version`,
		timeoutMs: 8e3,
		tag: "codegraph"
	})), {
		installed: !0,
		binaryPath: e,
		version: t.stdout.trim().split(/\r?\n/)[0] || null
	};
}
async function St(e) {
	let t = (e || "").trim(), n = t ? d.join(t, ".codegraph") : null, r = !!(n && f.existsSync(n)), i = await B();
	if (!i.installed || !i.binaryPath) return {
		installed: !1,
		binaryPath: null,
		projectRoot: t,
		indexed: r,
		indexPath: r ? n : null,
		version: null,
		raw: "",
		error: "未安裝 codegraph CLI。https://github.com/colbymchenry/codegraph — npm i -g @colbymchenry/codegraph"
	};
	if (!t || !f.existsSync(t)) return {
		installed: !0,
		binaryPath: i.binaryPath,
		projectRoot: t,
		indexed: !1,
		indexPath: null,
		version: i.version,
		raw: "",
		error: "請先選擇專案目錄"
	};
	let a = await A({
		command: `${z(i.binaryPath)} status -p ${z(t)}`,
		cwd: t,
		timeoutMs: 3e4,
		tag: "codegraph"
	}), o = [a.stdout, a.stderr].filter(Boolean).join("\n").slice(0, 12e3), s = /not initialized|Not initialized/i.test(o);
	return {
		installed: !0,
		binaryPath: i.binaryPath,
		projectRoot: t,
		indexed: !s && (r || a.ok),
		indexPath: f.existsSync(d.join(t, ".codegraph")) ? d.join(t, ".codegraph") : null,
		version: i.version,
		raw: o,
		error: s ? "專案尚未 codegraph init" : a.ok ? void 0 : a.stderr || `exit ${a.code}`
	};
}
async function Ct(e) {
	let t = (e || "").trim();
	if (!t || !f.existsSync(t)) return {
		ok: !1,
		output: "",
		error: "無效專案路徑"
	};
	let n = await B();
	if (!n.binaryPath) return {
		ok: !1,
		output: "",
		error: "codegraph 未安裝"
	};
	let r = await A({
		command: `${z(n.binaryPath)} init -p ${z(t)}`,
		cwd: t,
		timeoutMs: 6e5,
		tag: "codegraph"
	}), i = [r.stdout, r.stderr].filter(Boolean).join("\n").slice(0, 2e4);
	return {
		ok: r.ok || f.existsSync(d.join(t, ".codegraph")),
		output: i,
		error: r.ok ? void 0 : r.stderr || `exit ${r.code}`
	};
}
async function wt(e) {
	let t = (e || "").trim();
	if (!t || !f.existsSync(t)) return {
		ok: !1,
		output: "",
		error: "無效專案路徑"
	};
	let n = await B();
	if (!n.binaryPath) return {
		ok: !1,
		output: "",
		error: "codegraph 未安裝"
	};
	let r = await A({
		command: `${z(n.binaryPath)} sync -p ${z(t)}`,
		cwd: t,
		timeoutMs: 3e5,
		tag: "codegraph"
	}), i = [r.stdout, r.stderr].filter(Boolean).join("\n").slice(0, 2e4);
	return {
		ok: r.ok,
		output: i,
		error: r.ok ? void 0 : r.stderr || `exit ${r.code}`
	};
}
async function V(e) {
	let t = (e || "").trim();
	if (!t || !f.existsSync(t)) return {
		ok: !1,
		error: "無效專案路徑 — 請先選擇專案"
	};
	let n = await B();
	return n.binaryPath ? f.existsSync(d.join(t, ".codegraph")) ? {
		ok: !0,
		bin: n.binaryPath,
		root: t
	} : {
		ok: !1,
		error: "專案尚未索引。請執行 codegraph init（知識圖譜頁「建立索引」）"
	} : {
		ok: !1,
		error: "codegraph 未安裝。npm i -g @colbymchenry/codegraph"
	};
}
async function H(e, t, n, r, i = 12e4) {
	let a = `${z(e)} ${n}`, o = await A({
		command: a,
		cwd: t,
		timeoutMs: i,
		tag: "codegraph"
	}), s = [o.stdout, o.stderr].filter(Boolean).join("\n\n").trim(), c = xt(o.stdout || "");
	return {
		ok: o.ok && !!(s || c),
		projectRoot: t,
		query: r,
		output: (s || (c ? JSON.stringify(c, null, 2) : "")).slice(0, 8e4),
		json: c,
		error: o.ok ? void 0 : o.stderr || `exit ${o.code}`,
		command: a
	};
}
async function Tt(e, t, n) {
	let r = (t || "").trim();
	if (!r) return {
		ok: !1,
		projectRoot: e || "",
		query: "",
		output: "",
		error: "query 不可為空",
		command: ""
	};
	let i = await V(e);
	if (!i.ok) return {
		ok: !1,
		projectRoot: e || "",
		query: r,
		output: "",
		error: i.error,
		command: ""
	};
	let a = n?.maxFiles && n.maxFiles > 0 ? ` --max-files ${Math.min(40, n.maxFiles)}` : "";
	return H(i.bin, i.root, `explore -p ${z(i.root)}${a} ${z(r)}`, r);
}
async function Et(e, t, n) {
	let r = (t || "").trim(), i = await V(e);
	if (!i.ok || !r) return {
		ok: !1,
		projectRoot: e || "",
		query: r,
		output: "",
		error: i.ok ? "search 不可為空" : i.error,
		command: ""
	};
	let a = n?.kind ? ` -k ${z(n.kind)}` : "", o = ` -l ${n?.limit && n.limit > 0 ? Math.min(50, n.limit) : 15}`, s = n?.json === !1 ? "" : " -j";
	return H(i.bin, i.root, `query -p ${z(i.root)}${a}${o}${s} ${z(r)}`, r);
}
async function Dt(e, t, n) {
	let r = (t || "").trim(), i = await V(e);
	if (!i.ok || !r) return {
		ok: !1,
		projectRoot: e || "",
		query: r,
		output: "",
		error: i.ok ? "symbol 不可為空" : i.error,
		command: ""
	};
	let a = ` -l ${n?.limit && n.limit > 0 ? Math.min(50, n.limit) : 20}`, o = n?.json === !1 ? "" : " -j";
	return H(i.bin, i.root, `callers -p ${z(i.root)}${a}${o} ${z(r)}`, r);
}
async function Ot(e, t, n) {
	let r = (t || "").trim(), i = await V(e);
	if (!i.ok || !r) return {
		ok: !1,
		projectRoot: e || "",
		query: r,
		output: "",
		error: i.ok ? "symbol 不可為空" : i.error,
		command: ""
	};
	let a = ` -l ${n?.limit && n.limit > 0 ? Math.min(50, n.limit) : 20}`, o = n?.json === !1 ? "" : " -j";
	return H(i.bin, i.root, `callees -p ${z(i.root)}${a}${o} ${z(r)}`, r);
}
async function kt(e, t, n) {
	let r = (t || "").trim(), i = await V(e);
	if (!i.ok || !r) return {
		ok: !1,
		projectRoot: e || "",
		query: r,
		output: "",
		error: i.ok ? "symbol 不可為空" : i.error,
		command: ""
	};
	let a = ` -d ${n?.depth && n.depth > 0 ? Math.min(8, n.depth) : 2}`, o = n?.json === !1 ? "" : " -j";
	return H(i.bin, i.root, `impact -p ${z(i.root)}${a}${o} ${z(r)}`, r);
}
async function At(e, t, n) {
	let r = (t || "").trim(), i = await V(e);
	if (!i.ok || !r) return {
		ok: !1,
		projectRoot: e || "",
		query: r,
		output: "",
		error: i.ok ? "name 不可為空" : i.error,
		command: ""
	};
	let a = n?.file ? ` -f ${z(n.file)}` : "";
	return H(i.bin, i.root, `node -p ${z(i.root)}${a} ${z(r)}`, r);
}
//#endregion
//#region electron/main.ts
var jt = d.dirname(ee(import.meta.url));
process.env.DIST = d.join(jt, "../dist"), process.env.VITE_PUBLIC = i.isPackaged ? process.env.DIST : d.join(process.env.DIST, "../public");
var U = null, W = null, G = !1;
function K(e = "executions") {
	let t = d.join(i.getPath("userData"), e);
	return f.existsSync(t) || f.mkdirSync(t, { recursive: !0 }), t;
}
function q() {
	return d.join(K("config"), "settings.json");
}
function Mt(e) {
	if (!e || typeof e != "object") return e;
	let t = { ...e }, n = t.customToolSecrets;
	return n && typeof n == "object" && l.isEncryptionAvailable() && (t.encryptedCustomToolSecrets = l.encryptString(JSON.stringify(n)).toString("base64"), delete t.customToolSecrets), t;
}
function Nt(e) {
	if (!e || typeof e != "object") return e;
	let t = { ...e }, n = t.encryptedCustomToolSecrets;
	if (typeof n == "string") {
		try {
			t.customToolSecrets = JSON.parse(l.decryptString(Buffer.from(n, "base64")));
		} catch {
			t.customToolSecrets = {};
		}
		delete t.encryptedCustomToolSecrets;
	}
	return t;
}
async function Pt(e) {
	(!U || U.isDestroyed()) && J();
	let t = U && !U.isDestroyed() ? U : null;
	t && (t.isMinimized() && t.restore(), t.isVisible() || t.show(), t.focus());
	let n = await Be(t, e);
	return !n.canceled && n.path && (Rt(n.path), U && !U.isDestroyed() && U.webContents.send("project:selected", n.path)), n;
}
function Ft() {
	let e = process.platform === "darwin", n = [
		...e ? [{
			label: i.name,
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" }
			]
		}] : [],
		{
			label: "檔案",
			submenu: [
				{
					label: "選擇專案資料夾…",
					accelerator: "CmdOrCtrl+O",
					click: () => {
						Pt();
					}
				},
				{ type: "separator" },
				e ? { role: "close" } : { role: "quit" }
			]
		},
		{
			label: "編輯",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" }
			]
		},
		{
			label: "檢視",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" }
			]
		},
		{
			label: "視窗",
			submenu: [
				{ role: "minimize" },
				{ role: "zoom" },
				...e ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }]
			]
		}
	];
	t.setApplicationMenu(t.buildFromTemplate(n));
}
function It() {
	let e = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVQ4T2NkYGD4z0ABYBzVMKoBBgP+/ydFG6MaRjWM5gE0NQAAK3YB/0m3w0sAAAAASUVORK5CYII=", "base64"), n = s.createFromBuffer(e);
	W = new r(n.isEmpty() ? s.createEmpty() : n), W.setToolTip("SubAgents AI");
	let a = t.buildFromTemplate([
		{
			label: "顯示 SubAgents AI",
			click: () => {
				U || J(), U?.show(), U?.focus();
			}
		},
		{
			label: "選擇專案資料夾…",
			click: () => {
				Pt();
			}
		},
		{
			label: "隱藏到系統匣",
			click: () => U?.hide()
		},
		{ type: "separator" },
		{
			label: "結束",
			click: () => {
				G = !0, i.quit();
			}
		}
	]);
	W.setContextMenu(a), W.on("double-click", () => {
		U?.show(), U?.focus();
	});
}
function J() {
	U = new e({
		width: 1440,
		height: 900,
		minWidth: 1024,
		minHeight: 700,
		title: "SubAgents AI",
		backgroundColor: "#0b1326",
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
		trafficLightPosition: process.platform === "darwin" ? {
			x: 14,
			y: 14
		} : void 0,
		webPreferences: {
			preload: d.join(jt, "preload.cjs"),
			contextIsolation: !0,
			nodeIntegration: !1,
			sandbox: !1
		},
		show: !1
	}), U.webContents.on("preload-error", (e, t, n) => {
		console.error("[preload-error]", t, n);
	}), U.once("ready-to-show", () => {
		U?.show();
	}), U.on("close", (e) => {
		G || (e.preventDefault(), U?.hide(), n.isSupported() && new n({
			title: "SubAgents AI",
			body: "已在背景執行，排程仍會持續運作。"
		}).show());
	}), U.webContents.setWindowOpenHandler(({ url: e }) => (u.openExternal(e), { action: "deny" })), process.env.VITE_DEV_SERVER_URL ? (U.loadURL(process.env.VITE_DEV_SERVER_URL), process.env.SUBAGENTS_DEVTOOLS === "1" && U.webContents.openDevTools({ mode: "detach" })) : U.loadFile(d.join(process.env.DIST, "index.html"));
}
i.whenReady().then(() => {
	Ft(), J(), It(), Gt(), oe((e) => {
		U && !U.isDestroyed() && U.webContents.send("webhook:event", e), n.isSupported() && new n({
			title: "SubAgents AI · Webhook",
			body: `已收到 ${e.source || "事件"}`
		}).show();
	}), we((e) => {
		U && !U.isDestroyed() && U.webContents.send("gateway:inbound", e), n.isSupported() && new n({
			title: `SubAgents AI · ${e.channel}`,
			body: `${e.from || e.chatId}: ${e.text.slice(0, 120)}`
		}).show();
	});
	try {
		let e = q();
		if (f.existsSync(e)) {
			let t = JSON.parse(f.readFileSync(e, "utf-8"));
			t.webhookEnabled && se({
				port: t.webhookPort || 8787,
				token: t.webhookToken || ""
			}).catch((e) => {
				console.error("Webhook auto-start failed", e);
			}), t.telegramEnabled && t.telegramBotToken && Oe({
				token: t.telegramBotToken,
				allowedChatIds: t.telegramAllowedChatIds || ""
			}).catch((e) => {
				console.error("Telegram gateway auto-start failed", e);
			});
		}
	} catch {}
	i.on("activate", () => {
		e.getAllWindows().length === 0 ? J() : U?.show();
	});
}), i.on("before-quit", () => {
	G = !0, ge(), ft(), O();
}), i.on("window-all-closed", () => {
	G && process.platform !== "darwin" && i.quit();
}), o.handle("archive:list", async () => {
	let e = K();
	return f.readdirSync(e).filter((e) => e.endsWith(".json")).map((t) => {
		let n = f.readFileSync(d.join(e, t), "utf-8");
		return JSON.parse(n);
	}).sort((e, t) => new Date(t.timestamp).getTime() - new Date(e.timestamp).getTime());
}), o.handle("archive:save", async (e, t) => {
	let n = K(), r = t.id, i = d.join(n, `${r}.json`);
	return f.writeFileSync(i, JSON.stringify(t, null, 2), "utf-8"), {
		ok: !0,
		path: i
	};
}), o.handle("archive:get", async (e, t) => {
	let n = d.join(K(), `${t}.json`);
	return f.existsSync(n) ? JSON.parse(f.readFileSync(n, "utf-8")) : null;
}), o.handle("archive:delete", async (e, t) => {
	let n = d.join(K(), `${t}.json`);
	return f.existsSync(n) && f.unlinkSync(n), { ok: !0 };
}), o.handle("settings:get", async () => {
	let e = q();
	if (!f.existsSync(e)) return null;
	try {
		return Nt(JSON.parse(f.readFileSync(e, "utf-8")));
	} catch {
		return null;
	}
}), o.handle("settings:set", async (e, t) => {
	let n = q();
	return f.writeFileSync(n, JSON.stringify(Mt(t), null, 2), "utf-8"), { ok: !0 };
}), o.handle("llm:chat", async (e, t) => {
	let n = (t.baseUrl || "https://api.openai.com/v1").replace(/\/$/, ""), r = {
		model: t.model,
		messages: t.messages,
		temperature: t.temperature ?? .4,
		max_tokens: t.max_tokens ?? 1200
	};
	t.tools && Array.isArray(t.tools) && t.tools.length > 0 && (r.tools = t.tools, r.tool_choice = t.tool_choice ?? "auto");
	let i = await fetch(`${n}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${t.apiKey}`
		},
		body: JSON.stringify(r)
	});
	if (!i.ok) {
		let e = await i.text().catch(() => i.statusText);
		throw Error(`LLM HTTP ${i.status}: ${e.slice(0, 300)}`);
	}
	let a = await i.json(), o = a.choices?.[0], s = o?.message, c = (s?.tool_calls || []).map((e) => ({
		id: e.id,
		name: e.function?.name || "",
		arguments: e.function?.arguments || "{}"
	}));
	return {
		content: (s?.content || "").trim(),
		tokensUsed: a.usage?.total_tokens ?? 0,
		model: a.model || t.model,
		toolCalls: c,
		finishReason: o?.finish_reason
	};
}), o.handle("llm:models", async (e, t) => {
	let n = (t.baseUrl || "").replace(/\/$/, ""), r = await fetch(`${n}/models`, { headers: { Authorization: `Bearer ${t.apiKey || ""}` } });
	if (!r.ok) throw Error(`HTTP ${r.status}`);
	return { models: ((await r.json()).data || []).map((e) => e.id || "").filter(Boolean) };
}), o.handle("app:notify", async (e, t, r) => (n.isSupported() && new n({
	title: t,
	body: r
}).show(), { ok: !0 })), o.handle("app:showWindow", async () => (U || J(), U?.show(), U?.focus(), { ok: !0 }));
var Y = null;
o.handle("power:preventSleep", async () => (Y != null && c.isStarted(Y) || (Y = c.start("prevent-app-suspension")), {
	ok: !0,
	id: Y
})), o.handle("power:allowSleep", async () => (Y != null && c.isStarted(Y) && c.stop(Y), Y = null, { ok: !0 })), o.handle("webhook:start", async (e, t) => se(t || {})), o.handle("webhook:stop", async () => ce()), o.handle("webhook:status", async () => v()), o.handle("app:userDataPath", () => i.getPath("userData"));
function Lt() {
	return d.join(K("config"), "hermes.json");
}
o.handle("hermes:get", async () => {
	let e = Lt();
	if (!f.existsSync(e)) return null;
	try {
		return JSON.parse(f.readFileSync(e, "utf-8"));
	} catch {
		return null;
	}
});
function X() {
	return K("plugins");
}
o.handle("plugins:list", async () => {
	let e = X();
	if (!f.existsSync(e)) return [];
	let t = f.readdirSync(e).filter((e) => e.endsWith(".json")), n = [];
	for (let r of t) try {
		let t = f.readFileSync(d.join(e, r), "utf-8");
		n.push(JSON.parse(t));
	} catch {}
	return n;
}), o.handle("plugins:save", async (e, t) => {
	let n = X(), r = d.join(n, `${t.id}.json`);
	return f.writeFileSync(r, JSON.stringify(t, null, 2), "utf-8"), {
		ok: !0,
		path: r
	};
}), o.handle("plugins:delete", async (e, t) => {
	let n = d.join(X(), `${t}.json`);
	return f.existsSync(n) && f.unlinkSync(n), { ok: !0 };
}), o.handle("plugins:dir", () => X()), o.handle("mcp:httpRpc", async (e, t) => de(t)), o.handle("mcp:stdioListTools", async (e, t) => pe(t)), o.handle("mcp:stdioCallTool", async (e, t) => me(t)), o.handle("mcp:stdioEnsure", async (e, t) => fe(t)), o.handle("mcp:stdioStop", async (e, t) => he(t)), o.handle("mcp:stdioStopAll", async () => ge()), o.handle("mcp:stdioSessions", async () => _e()), o.handle("mcp:discover", async (e, t) => ot(t)), o.handle("gateway:telegramStart", async (e, t) => Oe(t || { token: "" })), o.handle("gateway:telegramStop", async () => O()), o.handle("gateway:status", async () => E()), o.handle("gateway:send", async (e, t) => ke(t)), o.handle("shell:bash", async (e, t) => {
	let n = t.cwd;
	return n && !d.isAbsolute(n) && (n = d.resolve(Q(), n)), (!n || !f.existsSync(n)) && (n = Q()), A({
		...t,
		cwd: n
	});
}), o.handle("opencode:scanAgents", async (e, t) => {
	try {
		return j(t || Q());
	} catch (e) {
		return {
			global: [],
			project: [],
			dirs: [],
			error: e instanceof Error ? e.message : String(e)
		};
	}
}), o.handle("opencode:loadBundle", async (e, t) => {
	try {
		return Ie(t || Q());
	} catch (e) {
		return {
			layers: [],
			agents: [],
			commands: [],
			sources: [],
			error: e instanceof Error ? e.message : String(e)
		};
	}
}), o.handle("opencode:detect", async () => Le()), o.handle("opencode:run", async (e, t) => Re({
	...t,
	cwd: t.cwd || Q()
})), o.handle("opencode:hint", async () => ze({ cwd: Q() })), o.handle("project:pick", async (t, n) => {
	try {
		let r = e.fromWebContents(t.sender);
		(!r || r.isDestroyed()) && (r = e.getFocusedWindow() || U);
		let i = await Be(r, n?.defaultPath);
		return i.path && !i.canceled && Rt(i.path), i;
	} catch (e) {
		return {
			canceled: !1,
			path: null,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}), o.handle("project:inspect", async (e, t) => Ve(t || Q())), o.handle("project:branches", async (e, t) => Ue(t || Q())), o.handle("project:setActiveRoot", async (e, t) => Rt(t)), o.handle("project:getActiveRoot", async () => ({
	root: Q(),
	mode: Z ? "project" : "sandbox",
	projectRoot: Z
})), o.handle("cli:which", async (e, t) => {
	let n = (t || "").trim();
	if (!n) return {
		found: !1,
		path: null
	};
	let r = await A({
		command: process.platform === "win32" ? `where ${n}` : `command -v ${n}`,
		timeoutMs: 5e3
	}), i = r.stdout.trim().split(/\r?\n/)[0] || null;
	return {
		found: !!(i && r.ok),
		path: i
	};
}), o.handle("cli:discover", async () => nt()), o.handle("cli:applyDiscovery", async (e, t) => {
	let { clis: n, summary: r } = await nt(), i = rt(t || [], n), a = n.find((e) => e.id === "codex");
	return {
		providers: i,
		summary: r,
		clis: n,
		suggestedModel: a?.defaultModel || n.find((e) => e.models[0])?.models[0]?.id,
		suggestedDepth: a?.defaultDepth || "deep"
	};
}), o.handle("cli:runAgent", async (e, t) => {
	let n = t.cwd && f.existsSync(t.cwd) ? t.cwd : Q();
	return yt({
		...t,
		cwd: n
	});
}), o.handle("cli:cancel", async () => Ae({ tag: "cli-agent" })), o.handle("codegraph:detect", async () => B()), o.handle("codegraph:status", async (e, t) => St(t || Q())), o.handle("codegraph:init", async (e, t) => Ct(t || Q())), o.handle("codegraph:sync", async (e, t) => wt(t || Q())), o.handle("codegraph:explore", async (e, t) => Tt(t?.projectRoot || Q(), t?.query || "", { maxFiles: t?.maxFiles })), o.handle("codegraph:query", async (e, t) => Et(t?.projectRoot || Q(), t?.search || "", {
	kind: t?.kind,
	limit: t?.limit,
	json: t?.json
})), o.handle("codegraph:callers", async (e, t) => Dt(t?.projectRoot || Q(), t?.symbol || "", {
	limit: t?.limit,
	json: t?.json
})), o.handle("codegraph:callees", async (e, t) => Ot(t?.projectRoot || Q(), t?.symbol || "", {
	limit: t?.limit,
	json: t?.json
})), o.handle("codegraph:impact", async (e, t) => kt(t?.projectRoot || Q(), t?.symbol || "", {
	depth: t?.depth,
	json: t?.json
})), o.handle("codegraph:node", async (e, t) => At(t?.projectRoot || Q(), t?.name || "", { file: t?.file })), o.handle("term:create", async (e, t) => {
	let n = lt({
		cwd: t?.cwd,
		title: t?.title,
		webContents: e.sender
	});
	return pt(n.id, e.sender), n;
}), o.handle("term:list", async () => ct()), o.handle("term:write", async (e, t, n) => ut(t, n)), o.handle("term:kill", async (e, t) => dt(t)), o.handle("term:killAll", async () => (ft(), { ok: !0 })), o.handle("hermes:set", async (e, t) => {
	f.writeFileSync(Lt(), JSON.stringify(t, null, 2), "utf-8");
	try {
		let e = t, n = K("workspace"), r = d.join(n, "hermes");
		f.mkdirSync(r, { recursive: !0 }), e.memory?.userProfile != null && f.writeFileSync(d.join(r, "USER.md"), `# USER.md\n\n${e.memory.userProfile}\n`, "utf-8"), e.memory?.memory != null && f.writeFileSync(d.join(r, "MEMORY.md"), `# MEMORY.md\n\n${e.memory.memory}\n`, "utf-8"), e.soul && f.writeFileSync(d.join(r, "SOUL.md"), e.soul, "utf-8"), e.agents && f.writeFileSync(d.join(r, "AGENTS.md"), e.agents, "utf-8");
	} catch {}
	return { ok: !0 };
}), o.handle("app:platform", () => process.platform), o.handle("app:version", () => i.getVersion());
var Z = null;
function Q() {
	return Z && f.existsSync(Z) ? Z : K("workspace");
}
function Rt(e) {
	if (!e || !String(e).trim()) return Z = null, {
		ok: !0,
		root: Q(),
		mode: "sandbox"
	};
	let t = d.resolve(e);
	return !f.existsSync(t) || !f.statSync(t).isDirectory() ? {
		ok: !1,
		root: Q(),
		mode: Z ? "project" : "sandbox",
		error: "path is not a directory"
	} : (Z = t, {
		ok: !0,
		root: t,
		mode: "project"
	});
}
function $(e) {
	let t = Q(), n = (e || ".").replace(/^[/\\]+/, ""), r = d.resolve(t, n), i = t.endsWith(d.sep) ? t : t + d.sep;
	if (r !== t && !r.startsWith(i)) throw Error("Path escapes workspace sandbox");
	return r;
}
o.handle("tools:workspaceList", async (e, t = ".") => {
	let n = $(t);
	return f.existsSync(n) || f.mkdirSync(n, { recursive: !0 }), {
		path: t,
		entries: f.readdirSync(n, { withFileTypes: !0 }).map((e) => ({
			name: e.name,
			dir: e.isDirectory()
		}))
	};
}), o.handle("tools:workspaceRead", async (e, t) => {
	try {
		let e = $(t);
		return !f.existsSync(e) || f.statSync(e).isDirectory() ? {
			ok: !1,
			content: `Not found: ${t}`
		} : {
			ok: !0,
			content: f.readFileSync(e, "utf-8").slice(0, 2e5)
		};
	} catch (e) {
		return {
			ok: !1,
			content: e instanceof Error ? e.message : String(e)
		};
	}
}), o.handle("tools:workspaceWrite", async (e, t, n) => {
	try {
		let e = $(t);
		return f.mkdirSync(d.dirname(e), { recursive: !0 }), f.writeFileSync(e, n ?? "", "utf-8"), {
			ok: !0,
			path: t,
			bytes: Buffer.byteLength(n ?? "", "utf-8")
		};
	} catch (e) {
		return {
			ok: !1,
			path: t,
			bytes: 0,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}), o.handle("tools:workspaceDownload", async (e, t, n) => {
	try {
		let e = new URL(t);
		if (!["http:", "https:"].includes(e.protocol)) throw Error("Only http(s) URLs allowed");
		let r = $(n), i = await fetch(e, { redirect: "follow" });
		if (!i.ok) throw Error(`HTTP ${i.status}`);
		let a = Buffer.from(await i.arrayBuffer());
		if (a.length > 20 * 1024 * 1024) throw Error("Download exceeds 20MB limit");
		return f.mkdirSync(d.dirname(r), { recursive: !0 }), f.writeFileSync(r, a), {
			ok: !0,
			path: n,
			bytes: a.length
		};
	} catch (e) {
		return {
			ok: !1,
			path: n,
			bytes: 0,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}), o.handle("tools:workspaceMkdir", async (e, t) => {
	try {
		return f.mkdirSync($(t), { recursive: !0 }), {
			ok: !0,
			path: t
		};
	} catch (e) {
		return {
			ok: !1,
			path: t,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}), o.handle("tools:workspaceMove", async (e, t, n) => {
	try {
		let e = $(t), r = $(n);
		if (!f.existsSync(e)) throw Error(`Not found: ${t}`);
		return f.mkdirSync(d.dirname(r), { recursive: !0 }), f.renameSync(e, r), {
			ok: !0,
			from: t,
			to: n
		};
	} catch (e) {
		return {
			ok: !1,
			from: t,
			to: n,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}), o.handle("tools:workspaceDelete", async (e, t, n = !1) => {
	try {
		let e = $(t);
		if (!f.existsSync(e)) throw Error(`Not found: ${t}`);
		let r = f.statSync(e);
		if (r.isDirectory() && !n) throw Error("Directory deletion requires recursive=true");
		return f.rmSync(e, {
			recursive: r.isDirectory(),
			force: !1
		}), {
			ok: !0,
			path: t
		};
	} catch (e) {
		return {
			ok: !1,
			path: t,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}), o.handle("tools:workspaceRoot", () => Q()), o.handle("tools:workspaceMode", () => ({
	root: Q(),
	mode: Z ? "project" : "sandbox",
	projectRoot: Z
})), o.handle("tools:webSearch", async (e, t, n = 5) => {
	let r = (t || "").trim();
	if (!r) return {
		query: r,
		results: []
	};
	let i = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(r)}&limit=${n}&namespace=0&format=json`, a = await fetch(i, { headers: { "User-Agent": "SubAgentsAI/1.0 (desktop agent; research tool)" } });
	if (!a.ok) throw Error(`Search HTTP ${a.status}`);
	let o = await a.json(), s = o[1] || [], c = o[2] || [], l = o[3] || [];
	return {
		query: r,
		results: s.map((e, t) => ({
			title: e,
			snippet: c[t] || e,
			url: l[t]
		}))
	};
}), o.handle("tools:httpFetch", async (e, t, n = 4e3) => {
	try {
		let e = new URL(t);
		if (!["http:", "https:"].includes(e.protocol)) return {
			ok: !1,
			text: "Only http(s) URLs allowed",
			status: 0
		};
		let r = await fetch(e.toString(), {
			headers: { "User-Agent": "SubAgentsAI/1.0" },
			redirect: "follow"
		}), i = (await r.text()).slice(0, n);
		return {
			ok: r.ok,
			text: i,
			status: r.status
		};
	} catch (e) {
		return {
			ok: !1,
			text: e instanceof Error ? e.message : String(e),
			status: 0
		};
	}
}), o.handle("tools:httpRequest", async (e, t) => {
	try {
		let e = new URL(t.url);
		if (!["http:", "https:"].includes(e.protocol)) throw Error("Only http(s) URLs allowed");
		let n = await fetch(e, {
			method: t.method || "GET",
			headers: t.headers,
			body: t.body,
			redirect: "follow"
		});
		return {
			ok: n.ok,
			text: (await n.text()).slice(0, Math.min(Number(t.maxChars) || 5e4, 2e5)),
			status: n.status
		};
	} catch (e) {
		return {
			ok: !1,
			text: e instanceof Error ? e.message : String(e),
			status: 0
		};
	}
});
function zt() {
	return d.join(K("config"), "memory.json");
}
function Bt() {
	let e = zt();
	if (!f.existsSync(e)) return {};
	try {
		return JSON.parse(f.readFileSync(e, "utf-8"));
	} catch {
		return {};
	}
}
function Vt(e) {
	f.writeFileSync(zt(), JSON.stringify(e, null, 2), "utf-8");
}
o.handle("tools:memorySet", async (e, t, n) => {
	let r = Bt();
	return r[t] = n, Vt(r), { ok: !0 };
}), o.handle("tools:memoryGet", async (e, t) => Bt()[t] ?? null);
function Ht() {
	return d.join(K("config"), "jobs.json");
}
function Ut() {
	return d.join(K("config"), "events.json");
}
o.handle("scheduler:list", async () => {
	let e = Ht();
	if (!f.existsSync(e)) return [];
	try {
		return JSON.parse(f.readFileSync(e, "utf-8"));
	} catch {
		return [];
	}
}), o.handle("scheduler:saveAll", async (e, t) => (f.writeFileSync(Ht(), JSON.stringify(t, null, 2), "utf-8"), { ok: !0 })), o.handle("events:list", async () => {
	let e = Ut();
	if (!f.existsSync(e)) return [];
	try {
		return JSON.parse(f.readFileSync(e, "utf-8"));
	} catch {
		return [];
	}
}), o.handle("events:saveAll", async (e, t) => (f.writeFileSync(Ut(), JSON.stringify(t, null, 2), "utf-8"), { ok: !0 }));
var Wt = null;
function Gt() {
	Wt ||= setInterval(() => {
		!U || U.isDestroyed() || U.webContents.send("scheduler:tick", { at: (/* @__PURE__ */ new Date()).toISOString() });
	}, 15e3);
}
//#endregion
export {};
