// app.js: lo que usan index.html y proyector.html.
// Hace de "mesero": habla con Supabase, o con tu navegador si estás en MODO DEMO.

const CFG = window.CONFIG || {};
const MODO_DEMO = !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY;

// Identifica este celular para que solo pueda votar una vez.
const dispositivo = (() => {
  let id = localStorage.getItem("dispositivo");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("dispositivo", id);
  }
  return id;
})();

// ---------- SEGURIDAD: validar antes de enviar ----------
function validar(nombre, disfraz) {
  nombre = (nombre || "").trim();
  disfraz = (disfraz || "").trim();
  if (nombre.length < 2 || nombre.length > 30) return "El nombre debe tener entre 2 y 30 letras";
  if (disfraz.length < 2 || disfraz.length > 30) return "El disfraz debe tener entre 2 y 30 letras";
  return null;
}

// Solo mostramos fotos que vengan de https o de nuestra propia vista previa.
function urlSegura(u) {
  return typeof u === "string" && (u.startsWith("https://") || u.startsWith("data:image/"));
}

// ---------- ARCHIVOS: revisar y achicar la foto ----------
const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];

async function redimensionar(archivo, max = 480) {
  if (!TIPOS_FOTO.includes(archivo.type)) throw new Error("Solo se aceptan fotos jpg, png o webp");
  if (archivo.size > 15 * 1024 * 1024) throw new Error("La foto es demasiado grande (máximo 15 MB)");
  const bmp = await createImageBitmap(archivo);
  const escala = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(bmp.width * escala);
  lienzo.height = Math.round(bmp.height * escala);
  lienzo.getContext("2d").drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
  return new Promise((ok) => lienzo.toBlob(ok, "image/jpeg", 0.8));
}

function blobADataUrl(blob) {
  return new Promise((ok, fallo) => {
    const lector = new FileReader();
    lector.onload = () => ok(lector.result);
    lector.onerror = fallo;
    lector.readAsDataURL(blob);
  });
}

// ---------- DATOS: modo demo (guarda en el navegador) ----------
const canal = "BroadcastChannel" in window ? new BroadcastChannel("muro") : null;

const demo = {
  leer() {
    let lista = JSON.parse(localStorage.getItem("demo_participantes") || "null");
    if (!lista) {
      const ahora = Date.now();
      lista = [
        { id: "d1", nombre: "Ana", disfraz: "Fantasma", foto_url: null, votos: 4, creado_en: ahora - 3000 },
        { id: "d2", nombre: "Luis", disfraz: "Brujo", foto_url: null, votos: 2, creado_en: ahora - 2000 },
        { id: "d3", nombre: "Marta", disfraz: "Vampiresa", foto_url: null, votos: 1, creado_en: ahora - 1000 },
      ];
      localStorage.setItem("demo_participantes", JSON.stringify(lista));
    }
    return lista;
  },
  guardar(lista) {
    localStorage.setItem("demo_participantes", JSON.stringify(lista));
    if (canal) canal.postMessage("cambio");
  },
  async listar() {
    return this.leer().sort((a, b) => b.creado_en - a.creado_en);
  },
  async agregar({ nombre, disfraz, foto }) {
    const lista = this.leer();
    const foto_url = foto ? await blobADataUrl(foto) : null;
    lista.push({ id: crypto.randomUUID(), nombre, disfraz, foto_url, votos: 0, creado_en: Date.now() });
    this.guardar(lista);
  },
  async votar(id) {
    if (localStorage.getItem("mi_voto")) throw new Error("Ya votaste");
    const lista = this.leer();
    const p = lista.find((x) => x.id === id);
    if (!p) throw new Error("Ese disfraz no existe");
    p.votos += 1;
    this.guardar(lista);
  },
  suscribir(cuandoCambie) {
    if (canal) canal.onmessage = cuandoCambie;
    window.addEventListener("storage", cuandoCambie);
  },
};

// ---------- DATOS: Supabase (la cocina de verdad) ----------
const supa = {
  cliente: MODO_DEMO ? null : window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY),
  async listar() {
    // GET /participantes: ver el menú
    const { data, error } = await this.cliente.from("participantes").select("*").order("creado_en", { ascending: false });
    if (error) throw error;
    return data;
  },
  async agregar({ nombre, disfraz, foto }) {
    let foto_url = null;
    if (foto) {
      // ARCHIVOS: la foto va al Storage con un nombre único; en la tabla solo guardamos su dirección
      const ruta = crypto.randomUUID() + ".jpg";
      const subida = await this.cliente.storage.from("disfraces").upload(ruta, foto, { contentType: "image/jpeg" });
      if (subida.error) throw subida.error;
      foto_url = this.cliente.storage.from("disfraces").getPublicUrl(ruta).data.publicUrl;
    }
    // POST /participantes: hacer un pedido nuevo
    const { error } = await this.cliente.from("participantes").insert({ nombre, disfraz, foto_url });
    if (error) throw error;
  },
  async votar(id) {
    // Los votos pasan por una función del servidor que aplica las reglas
    const { error } = await this.cliente.rpc("votar", { p_id: id, p_dispositivo: dispositivo });
    if (error) throw error;
  },
  suscribir(cuandoCambie) {
    // Tiempo real: Supabase avisa cuando cambia la tabla
    this.cliente
      .channel("muro")
      .on("postgres_changes", { event: "*", schema: "public", table: "participantes" }, cuandoCambie)
      .subscribe();
  },
};

const db = MODO_DEMO ? demo : supa;

async function votar(id) {
  await db.votar(id);
  localStorage.setItem("mi_voto", id);
}

function mensajeError(e) {
  const m = (e && e.message) || String(e);
  if (/row-level security/i.test(m)) return "Las reglas no permiten esa acción";
  if (/check constraint/i.test(m)) return "Los datos no cumplen las reglas";
  if (/Failed to fetch|NetworkError/i.test(m)) return "No hay conexión con el servidor";
  return m;
}

// ---------- PANTALLA: dibujar tarjetas y ranking ----------
// Usamos textContent (nunca innerHTML) para que un nombre con <script> no pueda hacer daño.
function el(etiqueta, clase, texto) {
  const e = document.createElement(etiqueta);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

const EMOJIS = ["👻", "🎃", "🦇", "🧙", "🧛", "🧟", "💀", "🕷️"];
function emojiPara(nombre) {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) % 997;
  return EMOJIS[h % EMOJIS.length];
}

function textoVotos(n) {
  return n + (n === 1 ? " voto" : " votos");
}

function crearTarjeta(p, { miVoto, onVotar } = {}) {
  const tarjeta = el("article", "tarjeta");
  const foto = el("div", "foto");
  if (urlSegura(p.foto_url)) {
    const img = el("img");
    img.src = p.foto_url;
    img.alt = "Disfraz de " + p.nombre;
    foto.append(img);
  } else {
    foto.textContent = emojiPara(p.nombre);
  }
  tarjeta.append(foto, el("h3", "", p.nombre), el("p", "disfraz", p.disfraz), el("p", "votos", textoVotos(p.votos)));
  if (onVotar) {
    const boton = el("button", miVoto === p.id ? "mio" : "", miVoto === p.id ? "Tu voto" : "Votar");
    boton.disabled = Boolean(miVoto);
    boton.onclick = () => onVotar(p.id);
    tarjeta.append(boton);
  }
  return tarjeta;
}

const yaVistos = new Set();
function pintarMuro(contenedor, lista, opciones) {
  contenedor.replaceChildren();
  for (const p of lista) {
    const tarjeta = crearTarjeta(p, opciones);
    if (!yaVistos.has(p.id)) tarjeta.classList.add("nuevo");
    yaVistos.add(p.id);
    contenedor.append(tarjeta);
  }
  if (lista.length === 0) {
    const vacio = el("div", "vacio");
    vacio.append(el("div", "vacio-emoji", "👻"), el("p", "", "Aún no hay disfraces. ¡Sé la primera persona!"));
    contenedor.append(vacio);
  }
}

function pintarRanking(contenedor, lista) {
  const top = [...lista].sort((a, b) => b.votos - a.votos).slice(0, 5);
  const max = Math.max(1, top.length ? top[0].votos : 1);
  contenedor.replaceChildren();
  top.forEach((p, i) => {
    const barra = el("i");
    const pista = el("div", "barra");
    pista.append(barra);
    const fila = el("div", "fila");
    fila.append(el("span", "pos", String(i + 1)), el("span", "quien", p.nombre), pista, el("span", "n", String(p.votos)));
    contenedor.append(fila);
    requestAnimationFrame(() => requestAnimationFrame(() => (barra.style.width = Math.round((p.votos / max) * 100) + "%")));
  });
}
