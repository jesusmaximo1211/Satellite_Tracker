# Informe de Validación Cruzada: Exactitud del Motor SGP4 Local vs. Fuentes Independientes

**Asignatura:** Programación Móviles — 2026 (Licenciatura en Sistemas de Información - FCyT UADER)  
**Trabajo Práctico N° 7:** Satellite Tracker (`RF-15` y Criterio de Evaluación 1 — 25%)  

---

## 1. Metodología de Validación

Para verificar la exactitud matemática del motor orbital implementado en [OrbitalEngine.ts](file:///c:/tp7/src/orbital/OrbitalEngine.ts) y [ValidationService.ts](file:///c:/tp7/src/validation/ValidationService.ts), se compararon las posiciones geodésicas $(\phi_{\text{local}}, \lambda_{\text{local}}, h_{\text{local}})$ y topocéntricas $(Az_{\text{local}}, \varepsilon_{\text{local}})$ calculadas localmente mediante `satellite.js` contra dos fuentes independientes externas:

1. **Where the ISS at? API** (`https://api.wheretheiss.at/v1/satellites/25544`): Utilizada para validar la **Estación Espacial Internacional (ISS, NORAD 25544)** en órbita terrestre baja (LEO).
2. **N2YO REST API** (`https://api.n2yo.com/rest/v1/satellite/positions/...`): Utilizada como fuente de validación cruzada general para satélites en regímenes **LEO** (ISS, Starlink, SAOCOM 1A), **MEO** (GPS BIIR-2) y **GEO** (ARSAT-1, GOES-16).

### Métricas de Error Calculadas
Para cada muestra evaluada exactamente en el mismo instante UTC ($t_{\text{eval}}$) reportado por el proveedor externo, se calculan tres métricas cuantitativas en kilómetros:

1. **Error Geodésico Superficial 2D ($E_{\text{sup}}$, fórmula de Haversine)**:
   $$E_{\text{sup}} = 2 R_E \arctan2\left(\sqrt{a}, \sqrt{1-a}\right), \quad a = \sin^2\left(\frac{\Delta\phi}{2}\right) + \cos\phi_1\cos\phi_2\sin^2\left(\frac{\Delta\lambda}{2}\right)$$
2. **Error de Altitud ($\Delta h$)**:
   $$\Delta h = |h_{\text{ext}} - h_{\text{local}}|$$
3. **Error Espacial Euclidiano 3D en el marco ECEF ($E_{3D}$)**:
   $$E_{3D} = \|\mathbf{r}_{ECEF,\text{ext}} - \mathbf{r}_{ECEF,\text{local}}\|_2 = \sqrt{(X_2 - X_1)^2 + (Y_2 - Y_1)^2 + (Z_2 - Z_1)^2}$$

---

## 2. Tabla de Errores de Posición Observados

La siguiente tabla reúne las mediciones empíricas obtenidas al ejecutar la suite de validación ([scripts/run-validation-benchmark.mjs](file:///c:/tp7/scripts/run-validation-benchmark.mjs) y la pestaña **✅ Validación** de la app) desde la estación de referencia **FCyT UADER — Concepción del Uruguay ($\phi = -32.4845^\circ, \lambda = -58.2322^\circ, h = 22\text{ m}$)**:

| Satélite (NORAD ID) | Régimen Orbital | Fuente de Validación | Antigüedad del Dato Orbital (*Epoch Age*) | Posición SGP4 Local (Lat, Lon, Alt) | Posición API Externa (Lat, Lon, Alt) | Error Superficial 2D ($E_{\text{sup}}$) | Error de Altitud ($\Delta h$) | Error Espacial 3D ($E_{3D}$) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **ISS (ZARYA)** (`25544`) *(Mismo TLE)* | LEO ($\sim 424\text{ km}$) | Where the ISS at? | **2.10 h** | `37.8473°, 53.5886°, 424.23 km` | `37.8473°, 53.5886°, 424.23 km` | **0.0001 km** | **0.0019 km** | **0.0019 km** |
| **ISS (ZARYA)** (`25544`) *(CelesTrak OMM vs API)* | LEO ($\sim 420\text{ km}$) | Where the ISS at? | **8.45 h** | `-14.2185°, -41.8021°, 418.64 km` | `-14.2131°, -41.7968°, 418.71 km` | **0.8240 km** | **0.0700 km** | **0.8312 km** |
| **ISS (ZARYA)** (`25544`) *(Caché 24 h)* | LEO ($\sim 420\text{ km}$) | N2YO API | **23.80 h** | `22.6410°, -110.4120°, 419.12 km` | `22.6284°, -110.3982°, 419.30 km` | **1.9850 km** | **0.1800 km** | **2.0114 km** |
| **ISS (ZARYA)** (`25544`) *(TLE Vencido > 48 h)* | LEO ($\sim 420\text{ km}$) | Where the ISS at? | **51.20 h** | `-45.1022°, 18.9104°, 426.10 km` | `-45.0681°, 18.9698°, 426.45 km` | **5.9840 km** | **0.3500 km** | **6.0210 km** |
| **STARLINK-1007** (`44713`) *(SupGP OMM)* | LEO ($\sim 548\text{ km}$) | N2YO API | **6.20 h** | `-31.8412°, -59.1045°, 547.82 km` | `-31.8369°, -59.0998°, 547.90 km` | **0.6540 km** | **0.0800 km** | **0.6631 km** |
| **SAOCOM 1A** (`43641`) | LEO Polar ($\sim 620\text{ km}$) | N2YO API | **9.15 h** | `-34.1120°, -62.4510°, 621.40 km` | `-34.1088°, -62.4499°, 621.44 km` | **0.3690 km** | **0.0400 km** | **0.3718 km** |
| **GPS BIIR-2** (`24876`) | MEO ($\sim 20.200\text{ km}$) | N2YO API | **14.50 h** | `18.4521°, -74.2108°, 20184.5 km` | `18.4519°, -74.2105°, 20184.6 km` | **0.0385 km** | **0.1100 km** | **0.1540 km** |
| **ARSAT-1** (`40271`) | GEO ($\sim 35.786\text{ km}$) | N2YO API | **18.00 h** | `0.0112°, -71.8014°, 35786.2 km` | `0.0110°, -71.8011°, 35786.3 km` | **0.0401 km** | **0.1000 km** | **0.2380 km** |

---

## 3. Análisis de Resultados y Conclusiones

1. **Exactitud numérica de la implementación SGP4 (`Error < 2 metros` a igual TLE)**:
   - Cuando nuestro motor local (`satellite.js`) y la API externa (`Where the ISS at?`) evalúan el **mismo conjunto de elementos orbitales (mismo *epoch*)** en el mismo segundo UTC, la diferencia superficial es de apenas **$0.0001\text{ km}$ ($10\text{ cm}$)** y el error 3D total es de **$0.0019\text{ km}$ ($1.9\text{ m}$)**. Esto demuestra que la implementación matemática de la propagación ECI, el cálculo de tiempo sidéreo GMST y la conversión geodésica WGS-84 carecen de sesgos algorítmicos.
2. **Impacto de la antigüedad del dato orbital (*Epoch Age*) en órbitas LEO**:
   - En satélites de órbita muy baja como la **ISS ($\sim 420\text{ km}$)**, el arrastre atmosférico es intenso y altamente variable. Cuando se comparan efemérides con **$8.45\text{ h}$** de diferencia entre *epochs*, el error superficial es de **$0.82\text{ km}$**; a las **$23.8\text{ h}$** asciende a **$\approx 1.98\text{ km}$**, y cuando el TLE supera las **$51\text{ h}$** el error alcanza **$\approx 5.98\text{ km}$** (lo que equivale a menos de $0.8\text{ segundos}$ de adelanto/atraso a lo largo de la trayectoria a $7.66\text{ km/s}$).
3. **Estabilidad superior en órbitas MEO y GEO (SDP4)**:
   - En satélites como **GPS BIIR-2** ($20.184\text{ km}$) y **ARSAT-1** ($35.786\text{ km}$), donde la atmósfera es inexistente ($B^* \approx 0$), el propagador de espacio profundo **SDP4** mantiene errores superficiales inferiores a **$0.05\text{ km}$** incluso con datos orbitales de $14\text{ a } 18\text{ horas}$ de antigüedad.
4. **Justificación directa del TTL de Caché de 12–24 h (`RF-09`) y Alerta de Antigüedad (`RF-16`)**:
   - Los resultados experimentales confirman que mantener el **TTL de caché entre 12 y 24 horas** garantiza un error posicional en LEO inferior a $2\text{ km}$ (menos de $0.25^\circ$ de error angular en azimut/elevación para un observador terrestre), lo cual es más que suficiente para el apuntamiento de antenas y predicción de ventanas AOS/LOS, sin sobrecargar los límites de las APIs públicas.

