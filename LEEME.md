# Muro de disfraces en vivo

Dos páginas, sin instalar nada:

- `index.html`: la página del celular (registrarse, subir foto, votar).
- `proyector.html`: el muro grande con QR, ranking y botón "Revelar ganador".

Archivos para personalizar: `estilos.css` (colores y estilo) y `index.html`.

## Probar ya, sin Supabase (modo demo)

Con `config.js` vacío la app funciona con datos guardados en el navegador.
Abre `proyector.html` e `index.html` en dos pestañas y verás que se sincronizan.

```bash
python -m http.server 8000
```

Luego entra a `http://localhost:8000/proyector.html`.

## Conectar Supabase (profesor, una sola vez)

1. Crea un proyecto en supabase.com.
2. Abre **SQL Editor**, pega todo `setup.sql` y pulsa **Run**.
3. En **Project Settings > API** copia la **Project URL** y la clave **anon** (la pública) a `config.js`.
   Nunca uses la clave `service_role`.
4. Publica la carpeta (GitHub Pages, Netlify o Vercel) y abre `proyector.html` en el proyector.
5. Limpiar el muro: en SQL Editor ejecuta `delete from participantes;`.

## Pasos de la clase

| Paso | Qué se ve | Dónde mirar |
|---|---|---|
| 1 | Leer participantes (GET) | `supa.listar` en `app.js` |
| 2 | Registrar (POST) | `supa.agregar` en `app.js` |
| 3 | Seguridad: validar, RLS, `textContent` | `validar` en `app.js` y `setup.sql` |
| 4 | Archivos: foto al Storage | `redimensionar` y `supa.agregar` |
| 5 | Votar y ranking | `supa.votar`, `pintarRanking` |
