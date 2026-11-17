// Relais de l'Atelier MTG en ligne. Deux rôles :
// 1. Commander Spellbook refuse les pages web (pas de CORS) : le relais transmet ces trois demandes, pour le site
//    (atelier-mtg.com). Aucun secret, rien n'est gardé.
// 2. Le pont avec le module Claude d'un PC (2.5.0). Le site ne joint plus l'Atelier du PC à son adresse locale
//    (127.0.0.1) : les navigateurs demandent pour ça une autorisation qu'un refus bloque des jours. Le PC ouvre ici une
//    connexion (il sort vers internet, comme n'importe quel programme), le site aussi ; le relais passe les messages
//    de l'un à l'autre, sans rien garder. Un objet Pont par PC, nommé par le canal : l'empreinte d'une preuve que seul
//    ce PC donne (compte.py › secret_pont). Les demandes du site sont signées avec le secret, que le PC vérifie.
import { DurableObject } from "cloudflare:workers";

const ORIGINES = ["https://atelier-mtg.com", "https://app.atelier-mtg.com"];
const SPELLBOOK = "https://backend.commanderspellbook.com/";
const MAX = 300000;                                       // octets : une liste de 100 cartes en fait moins de 10 000
const MAX_PONT = 4 << 20;                                 // octets par message du pont (une discussion entière)

function entetes(origine) {
  return { "Access-Control-Allow-Origin": origine, "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin" };
}

function reponse(corps, statut, origine) {
  return new Response(corps, { status: statut, headers: { ...entetes(origine), "Content-Type": "application/json; charset=utf-8" } });
}

async function empreinte(texte) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// /pont/<canal> : une connexion WebSocket. Le PC donne ?pc=<preuve> (canal = empreinte de la preuve) ; le site, sans
// preuve, doit venir d'atelier-mtg.com (ou d'une origine d'essai : variable ORIGINES_ESSAI, pour le banc)
async function pont(req, env, canal) {
  if (req.headers.get("Upgrade") !== "websocket") return new Response("WebSocket seulement", { status: 426 });
  const preuve = new URL(req.url).searchParams.get("pc");
  let role;
  if (preuve) {
    if (preuve.length > 200 || (await empreinte(preuve)) !== canal) return new Response("", { status: 403 });
    role = "pc";
  } else {
    const essai = String(env.ORIGINES_ESSAI || "").split(",").filter(Boolean);
    if (![...ORIGINES, ...essai].includes(req.headers.get("Origin") || "")) return new Response("", { status: 403 });
    role = "site";
  }
  const h = new Headers(req.headers);
  h.set("X-Pont-Role", role);
  return env.PONT.get(env.PONT.idFromName(canal)).fetch(new Request(req.url, { headers: h }));
}

export default {
  async fetch(req, env) {
    const chemin = new URL(req.url).pathname;
    const p = chemin.match(/^\/pont\/([0-9a-f]{64})$/);
    if (p) return pont(req, env, p[1]);
    const origine = req.headers.get("Origin") || "";
    if (!ORIGINES.includes(origine)) return new Response("", { status: 403 });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: entetes(origine) });
    if (req.method !== "POST") return reponse('{"erreur":"POST seulement"}', 405, origine);
    const corps = await req.text();
    if (corps.length > MAX) return reponse('{"erreur":"trop long"}', 413, origine);
    try {
      if (chemin === "/spellbook/variants") {               // les combos d'une carte : {q} (syntaxe de recherche de Spellbook)
        const q = String(JSON.parse(corps || "{}").q || "");
        if (!q || q.length > 300) return reponse('{"erreur":"recherche manquante"}', 400, origine);
        const r = await fetch(SPELLBOOK + "variants/?" + new URLSearchParams({ q, limit: "60" }),
          { headers: { "Accept": "application/json", "User-Agent": "atelier-mtg" } });
        return reponse(await r.text(), r.status, origine);
      }
      const sb = chemin.match(/^\/spellbook\/(find-my-combos|estimate-bracket)$/);
      if (sb) {
        const r = await fetch(SPELLBOOK + sb[1], { method: "POST", body: corps,
          headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "atelier-mtg" } });
        return reponse(await r.text(), r.status, origine);
      }
    } catch (e) {
      return reponse(JSON.stringify({ erreur: String(e && e.message || e) }), 502, origine);
    }
    return reponse('{"erreur":"inconnu"}', 404, origine);
  },
};

// Le pont d'un PC : sa connexion (une seule : la nouvelle remplace l'ancienne) et celles des pages du site ouvertes.
// Les connexions dorment entre deux messages (hibernation : rien n'est facturé) ; « ping » reçoit « pong » sans
// réveiller l'objet. Messages (JSON) :
//   site → relais : {type: "etat"} ; {type: "appel", id, ts, methode, chemin, corps, sig}
//   relais → PC   : l'appel, avec de (la page qui attend la réponse)
//   PC → relais   : {type: "reponse", id, de, statut, corps}
//   relais → site : {type: "reponse", id, statut, corps} ; {type: "etat", pc} (à l'ouverture, puis quand le PC arrive ou part)
export class Pont extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  ouverts(tag, sauf) {
    return this.ctx.getWebSockets(tag).filter((w) => w !== sauf && w.readyState === WebSocket.OPEN);
  }

  diffuser(message, sauf) {
    const texte = JSON.stringify(message);
    for (const w of this.ouverts("site", sauf)) { try { w.send(texte); } catch (_) { /* fermée entre-temps */ } }
  }

  async fetch(req) {
    const role = req.headers.get("X-Pont-Role");
    const [client, serveur] = Object.values(new WebSocketPair());
    if (role === "pc") {
      for (const w of this.ouverts("pc")) { try { w.close(4000, "remplacée"); } catch (_) { /* déjà fermée */ } }
      this.ctx.acceptWebSocket(serveur, ["pc"]);
      serveur.serializeAttachment({ role: "pc" });
      this.diffuser({ type: "etat", pc: true });
    } else {
      const id = crypto.randomUUID();
      this.ctx.acceptWebSocket(serveur, ["site", "site:" + id]);
      serveur.serializeAttachment({ role: "site", id });
      serveur.send(JSON.stringify({ type: "etat", pc: this.ouverts("pc").length > 0 }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, brut) {
    if (typeof brut !== "string" || brut.length > MAX_PONT) return;
    const a = ws.deserializeAttachment() || {};
    let m;
    try { m = JSON.parse(brut); } catch (_) { return; }
    if (!m || typeof m !== "object") return;
    if (a.role === "site") {
      if (m.type === "etat") return ws.send(JSON.stringify({ type: "etat", pc: this.ouverts("pc").length > 0 }));
      if (m.type !== "appel") return;
      const pc = this.ouverts("pc")[0];
      if (!pc) return ws.send(JSON.stringify({ type: "reponse", id: m.id, statut: 503, corps: '{"erreur":"absent","absent":true}' }));
      pc.send(JSON.stringify({ ...m, de: a.id }));
    } else if (a.role === "pc" && m.type === "reponse" && typeof m.de === "string") {
      const site = this.ouverts("site:" + m.de)[0];
      if (site) site.send(JSON.stringify({ type: "reponse", id: m.id, statut: m.statut, corps: m.corps }));
    }
  }

  async webSocketClose(ws, code, raison) {
    const a = ws.deserializeAttachment() || {};
    try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, String(raison || "").slice(0, 100)); } catch (_) { /* déjà fermée */ }
    if (a.role === "pc") this.diffuser({ type: "etat", pc: this.ouverts("pc", ws).length > 0 });
  }

  async webSocketError(ws) {
    const a = ws.deserializeAttachment() || {};
    if (a.role === "pc") this.diffuser({ type: "etat", pc: this.ouverts("pc", ws).length > 0 });
  }
}
