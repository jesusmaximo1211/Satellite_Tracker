# 🛰️ TP N° 7 — Satellite Tracker (React Native + TypeScript + SGP4)

**Licenciatura en Sistemas de Información — Programación Móviles (2026) — FCyT UADER**  
*Visualización de geoposiciones satelitales en tiempo real y predictor de visibilidad con propagación orbital SGP4/SDP4.*

---

## 📋 Resumen del Proyecto

Aplicación móvil desarrollada en **React Native (Expo) + TypeScript** que obtiene elementos orbitales reales desde APIs públicas (**CelesTrak GP & Starlink SupGP**, **Space-Track.org**, **N2YO** y **Where the ISS at?**), propaga localmente la posición de satélites en órbitas **LEO, MEO y GEO** mediante el algoritmo estándar de la industria **SGP4/SDP4** (`satellite.js` v7.1.0), representa en tiempo real el punto subsatelital, el *ground track* (con corte matemático en el antimeridiano $\pm 180^\circ$), el *footprint* de cobertura y una capa de constelación **Starlink**, predice ventanas de visibilidad (**AOS / MAX / LOS**) mediante búsqueda por refinamiento (grueso $\rightarrow$ fino), grafica la trayectoria en un **Sky Chart Polar SVG**, ofrece un **Modo Brújula** asistido por sensores y valida la exactitud posicional en kilómetros contra fuentes independientes.

---

## 🏗️ Arquitectura en 8 Capas Implementada

| Capa | Archivo Principal | Responsabilidad |
| :--- | :--- | :--- |
| **1. Data Provider Layer** | [`src/providers/DataOrchestrator.ts`](file:///c:/tp7/src/providers/DataOrchestrator.ts), [`CelesTrakProvider.ts`](file:///c:/tp7/src/providers/CelesTrakProvider.ts), [`SpaceTrackProvider.ts`](file:///c:/tp7/src/providers/SpaceTrackProvider.ts), [`N2yoProvider.ts`](file:///c:/tp7/src/providers/N2yoProvider.ts), [`WhereTheIssProvider.ts`](file:///c:/tp7/src/providers/WhereTheIssProvider.ts), [`RateLimiter.ts`](file:///c:/tp7/src/providers/RateLimiter.ts), [`OrbitalCache.ts`](file:///c:/tp7/src/providers/OrbitalCache.ts) | Interfaz común `DataProvider`, caché local con TTL (12–24 h), rate limiting por proveedor con backoff exponencial, fallback automático y protección de credenciales (`SecureStore` + Proxy Node.js en [`server/index.js`](file:///c:/tp7/server/index.js)). |
| **2. Orbital Engine** | [`src/orbital/OrbitalEngine.ts`](file:///c:/tp7/src/orbital/OrbitalEngine.ts) | Propagación SGP4/SDP4 desde **OMM/JSON** (soporte de NORAD IDs de 6 dígitos) y **TLE**, conversión $ECI \rightarrow \text{Geodésica WGS84}$ y $ECI \rightarrow \text{Topocéntrica}$, corte de *ground track* en el antimeridiano y geometría esférica de *footprint*. |
| **3. Observer Layer** | [`src/observer/ObserverService.ts`](file:///c:/tp7/src/observer/ObserverService.ts) | Posición GPS del observador (`expo-location`), estaciones terrenas predefinidas (FCyT UADER, CONAE Córdoba, CABA, Ushuaia) y fusión de magnetómetro/acelerómetro (`expo-sensors`). |
| **4. Prediction Service** | [`src/prediction/PassPredictor.ts`](file:///c:/tp7/src/prediction/PassPredictor.ts) | Algoritmo de búsqueda por refinamiento (paso grueso de $60\text{ s} \rightarrow$ bisección binaria y búsqueda ternaria con precisión $< 1\text{ s}$) para detectar **AOS**, **MAX** y **LOS** sin bloquear el hilo de UI. |
| **5. Geo/Map Layer** | [`src/components/WorldMapView.tsx`](file:///c:/tp7/src/components/WorldMapView.tsx) | Mapa mundial con marcador en tiempo real, *ground track* dividido en el antimeridiano, *footprint* dinámico y capa de constelación **Starlink** con *throttling* (compatible con `react-native-maps` nativo y Planisferio Táctico SVG). |
| **6. Validation Layer** | [`src/validation/ValidationService.ts`](file:///c:/tp7/src/validation/ValidationService.ts) | Comparación instantánea de posiciones locales contra **Where the ISS at?** y **N2YO**, calculando error superficial Haversine 2D, error de altitud y error espacial 3D ECEF en kilómetros. |
| **7. Presentation Layer** | [`App.tsx`](file:///c:/tp7/App.tsx), [`src/components/SkyChartPolar.tsx`](file:///c:/tp7/src/components/SkyChartPolar.tsx), [`src/components/CompassOverlay.tsx`](file:///c:/tp7/src/components/CompassOverlay.tsx) | Interfaz de control de misión con Sky Chart polar en SVG, modo brújula asistido, buscador de catálogo e inspector de resiliencia. |
| **8. Notification Layer** | [`src/notifications/NotificationService.ts`](file:///c:/tp7/src/notifications/NotificationService.ts) | Recordatorios programados $N$ minutos antes de un pase (`expo-notifications`), disparador de prueba para la demo y refresco periódico en segundo plano (`expo-background-fetch` / `expo-task-manager`). |

---

## 📚 Documentación y Entregables del TP7

Todos los informes técnicos exigidos en la **Sección 6 (Entregables)** se encuentran en la carpeta [`docs/`](file:///c:/tp7/docs):

1. 📄 **[01_Modelo_Propagacion_Orbital.md](file:///c:/tp7/docs/01_Modelo_Propagacion_Orbital.md)**: Explicación matemática del modelo SGP4/SDP4, transformaciones de coordenadas, soporte OMM de 6 dígitos, corte en antimeridiano, footprint, algoritmo AOS/LOS y análisis de supuestos y limitaciones (ausencia de refracción atmosférica fina, variabilidad del arrastre $B^*$, maniobras activas).
2. 📊 **[02_Informe_Validacion.md](file:///c:/tp7/docs/02_Informe_Validacion.md)**: Tabla de errores medidos en kilómetros entre el motor local y `Where the ISS at?` / `N2YO`, evaluación del impacto de la antigüedad del *epoch* en LEO/MEO/GEO y conclusiones.
3. 🔌 **[03_Decisiones_Fuentes_Datos.md](file:///c:/tp7/docs/03_Decisiones_Fuentes_Datos.md)**: Justificación del uso del dataset suplementario (`SupGP`) de Starlink frente a las restricciones de las APIs Enterprise y Space Traffic Coordination (mTLS), tabla de *rate limits*, estrategia de caché con TTL y arquitectura de fallback.
4. 🎬 **[04_Guia_Ejecucion_y_Guion_Video_Demo.md](file:///c:/tp7/docs/04_Guia_Ejecucion_y_Guion_Video_Demo.md)**: Instrucciones de ejecución y guion detallado minuto a minuto para grabar el **Video Demo**.

---

## 🚀 Inicio Rápido

```powershell
# 1. Ejecutar suite de validación orbital SGP4 en consola
node scripts/run-validation-benchmark.mjs

# 2. (Opcional) Iniciar el micro-backend proxy en http://localhost:3001
node server/index.js

# 3. Iniciar la aplicación React Native / Expo
npm start
```

