# Guía de Ejecución, Compilación y Guion para el Video Demo

**Asignatura:** Programación Móviles — 2026 (Licenciatura en Sistemas de Información - FCyT UADER)  
**Trabajo Práctico N° 7:** Satellite Tracker  

---

## 1. Cómo Ejecutar el Proyecto

### 1.1. Ejecutar la Aplicación Móvil (Expo / Metro Bundler)
Desde el directorio raíz `c:\tp7`:

```powershell
# Iniciar Metro Bundler (para abrir en Expo Go en Android/iOS, Emulador Android o Navegador Web)
npm start

# O abrir directamente en modo Web interactivo:
npm run web

# O abrir en emulador/dispositivo Android conectado por ADB:
npm run android
```

### 1.2. Ejecutar el Micro-Backend Proxy en Node.js (Opcional, para Space-Track y N2YO)
Si deseás utilizar el servidor proxy/caché local que resguarda las credenciales de `Space-Track.org` y `N2YO`:

```powershell
# 1. Copiar el archivo de ejemplo y completar tus claves (opcional)
Copy-Item server\.env.example server\.env

# 2. Iniciar el servidor proxy en http://localhost:3001
node server/index.js
```

### 1.3. Ejecutar la Suite de Validación Orbital SGP4 por Consola
Para verificar los cálculos matemáticos de `satellite.js` y medir en vivo el error en kilómetros contra la API de la ISS:

```powershell
node scripts/run-validation-benchmark.mjs
```

---

## 2. Guion Paso a Paso para Grabar el Video Demo (Entregable 6)

La cátedra solicita en la **Sección 6 (Entregables)**:
> *"Video demo mostrando: selección de un satélite real (ej. ISS), su posición en el mapa en tiempo real con ground track y footprint, la capa de constelación Starlink, el próximo pase visible con sky chart y una notificación disparada."*

Seguí este guion de **2 a 3 minutos** para cubrir el 100% de los puntos evaluados en orden:

1. **Selección de un satélite real y Posición en Tiempo Real (`00:00 - 00:40`)**:
   - Abrí la app en la pestaña **🌍 Mapa & SGP4**.
   - Mostrá el buscador y los filtros por categoría (`🛰️ Estaciones (ISS)`, `✨ Starlink (SupGP)`, `🌦️ Clima / SAOCOM`, `🧭 GNSS / GPS`, `📡 GEO / ARSAT`).
   - Seleccioná **ISS (ZARYA) — NORAD 25544**.
   - Señalá cómo el marcador rojo se actualiza en tiempo real cada $1.5\text{ s}$ calculado localmente con **SGP4**, y mostrá el panel inferior de telemetría (Latitud, Longitud, Altitud, Velocidad orbital, Azimut, Elevación y el badge verde de **Efeméride Vigente** con su antigüedad en horas).
2. **Ground Track (cruce del antimeridiano) y Footprint (`00:40 - 01:15`)**:
   - En el mismo mapa, señalá la trayectoria pasada (línea punteada gris) y futura de una órbita completa (línea celeste), destacando cómo **al cruzar el antimeridiano ($\pm 180^\circ$) la polilínea se divide limpiamente en segmentos** sin rayar horizontalmente el mapa.
   - Cambiá el selector de **Elevación Mínima ($\varepsilon_{\min}$)** entre `0°`, `10°` y `25°` para mostrar cómo el **Footprint (área verde de cobertura)** recalcula su radio en kilómetros instantáneamente.
3. **Capa de Constelación Starlink sin degradar la UI (`01:15 - 01:45`)**:
   - Tocá el botón **"✨ Mostrar Capa Constelación Starlink (RF-13)"**.
   - Mostrá cómo aparecen decenas de satélites **Starlink** simultáneamente sobre el mapa (puntos amarillos/naranjas propagados en lote con *throttling*), cambiá el límite entre `Máx 20`, `Máx 36` y `Máx 60`, y tocá también el filtro superior `✨ Starlink (SupGP)` para mostrar el soporte de objetos con **NORAD ID de 6 dígitos en formato OMM/JSON**.
4. **Próximo Pase Visible, Sky Chart Polar (SVG) y Notificación Disparada (`01:45 - 02:20`)**:
   - Volvé a seleccionar **ISS (ZARYA)** y abrí la pestaña **🔭 Pases**.
   - Mostrá el listado de próximas ventanas de visibilidad calculadas con el algoritmo de refinamiento (grueso $\rightarrow$ fino), indicando **AOS**, **Elevación Máxima (MAX)** y **LOS**.
   - Señalá el **Sky Chart Polar en SVG** con los anillos de elevación ($0^\circ, 30^\circ, 60^\circ$), el umbral $\varepsilon_{\min}$ y la curva azul de la trayectoria desde `AOS` hasta `LOS`.
   - Tocá el botón **"🔔 -10m"** en un pase y luego presioná **"⚡ Disparar Notificación de Pase Ahora (Para Video Demo)"** para mostrar en pantalla la alerta y notificación disparada con los datos del pase.
5. **Modo Brújula y Validación Cruzada en km (`02:20 - 03:00`)**:
   - Pasá brevemente por la pestaña **🧭 Brújula**, mostrá cómo guía el apuntamiento en Azimut y Elevación y tocá **"🎯 Alinear al Satélite"** para mostrar el estado verde de antena alineada.
   - Finalmente, abrí la pestaña **✅ Validación**, presioná **"🛰️ Validar ISS contra WhereTheISS API"** y mostrá la tabla con el error medido en kilómetros ($< 1\text{ km}$) y el botón de simulación de fallback entre proveedores.

