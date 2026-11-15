// Relais de l'Atelier MTG en ligne : Commander Spellbook refuse les pages web (pas de CORS). Le relais transmet seulement
// ces trois demandes, pour l'appli app.atelier-mtg.com. Aucun secret, rien n'est gardé. (Jusqu'à la refonte des comptes,
// il transmettait aussi la connexion à GitHub : elle n'existe plus.)
const ORIGINES = ["https://app.atelier-mtg.com"];
const SPELLBOOK = "https://backend.commanderspellbook.com/";
const MAX = 300000;                                       // octets : une liste de 100 cartes en fait moins de 10 000

function entetes(origine) {
  return { "Access-Control-Allow-Origin": origine, "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin" };
}

function reponse(corps, statut, origine) {
  return new Response(corps, { status: statut, headers: { ...entetes(origine), "Content-Type": "application/json; charset=utf-8" } });
}

export default {
  async fetch(req) {
    const origine = req.headers.get("Origin") || "";
    if (!ORIGINES.includes(origine)) return new Response("", { status: 403 });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: entetes(origine) });
    if (req.method !== "POST") return reponse('{"erreur":"POST seulement"}', 405, origine);
    const corps = await req.text();
    if (corps.length > MAX) return reponse('{"erreur":"trop long"}', 413, origine);
    const chemin = new URL(req.url).pathname;
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
