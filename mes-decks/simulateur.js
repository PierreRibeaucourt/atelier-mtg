// Le simulateur de l'Atelier (outils/simu*.py) dans le navigateur : Python compilé en WebAssembly (Pyodide), dans un
// Worker pour ne pas figer l'écran. telephone.js › simu() appelle les fonctions de simu_navigateur.py :
// { n, f, a } → { n, r } ou { n, e }. « init » charge Pyodide (une fois, ≈ 10 Mo gardés ensuite par le navigateur) et les
// fichiers Python de l'appli.
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
let module = null;

async function init(fichiers) {
  if (module) return true;
  try {
    importScripts(PYODIDE + "pyodide.js");
  } catch (e) {
    throw new Error("Le simulateur n'a pas pu se charger : vérifie la connexion.");
  }
  const py = await loadPyodide({ indexURL: PYODIDE });
  py.FS.mkdirTree("/sim");
  for (const [nom, url] of Object.entries(fichiers)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("Le simulateur n'a pas pu se charger : recharge l'appli.");
    py.FS.writeFile("/sim/" + nom, await r.text());
  }
  py.runPython('import os, sys\nsys.path.insert(0, "/sim")\nos.chdir("/sim")');
  module = py.pyimport("simu_navigateur");
  return true;
}

// une erreur de Python arrive avec toute sa trace : on garde sa dernière ligne, sans le nom de l'exception
const message = (e) => {
  const l = String((e && e.message) || e).trim().split("\n").filter(Boolean).pop() || "Erreur du simulateur.";
  return l.replace(/^[\w.]+(Error|Exception|Inconnue): /, "");
};

onmessage = async (ev) => {
  const { n, f, a } = ev.data;
  try {
    const r = f === "init" ? await init(...a) : module[f](...a);
    postMessage({ n, r });
  } catch (e) {
    postMessage({ n, e: message(e) });
  }
};
