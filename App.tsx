/**
 * TP N° 7 — Satellite Tracker (Programación Móviles 2026 - FCyT UADER)
 * Visualización de geoposiciones satelitales en tiempo real y predictor de visibilidad con propagación orbital SGP4.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CompassOverlay } from './src/components/CompassOverlay';
import { SkyChartPolar } from './src/components/SkyChartPolar';
import { WorldMapView } from './src/components/WorldMapView';
import { notificationService, ScheduledAlertItem } from './src/notifications/NotificationService';
import { observerService, PRESET_LOCATIONS } from './src/observer/ObserverService';
import { orbitalEngine } from './src/orbital/OrbitalEngine';
import { passPredictor } from './src/prediction/PassPredictor';
import { credentialStore } from './src/providers/CredentialStore';
import { dataOrchestrator, ProviderEventLog } from './src/providers/DataOrchestrator';
import { orbitalCache } from './src/providers/OrbitalCache';
import { rateLimiter } from './src/providers/RateLimiter';
import {
  ConstellationCategory,
  FootprintGeometry,
  GroundTrackSegment,
  ObserverLocation,
  OrbitalElements,
  PassWindow,
  SatelliteRealtimeState,
  ValidationComparisonResult,
} from './src/types/orbital';
import { validationService } from './src/validation/ValidationService';

type ActiveTab = 'map' | 'passes' | 'compass' | 'validation';

const CATEGORIES: Array<{ id: ConstellationCategory; label: string }> = [
  { id: 'stations', label: '🛰️ Estaciones (ISS)' },
  { id: 'starlink', label: '✨ Starlink (SupGP)' },
  { id: 'weather', label: '🌦️ Clima / SAOCOM' },
  { id: 'gnss', label: '🧭 GNSS / GPS' },
  { id: 'geo', label: '📡 GEO / ARSAT' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('map');

  // Catálogo y filtros (RF-01, RF-08)
  const [selectedCategory, setSelectedCategory] = useState<ConstellationCategory>('stations');
  const [catalog, setCatalog] = useState<OrbitalElements[]>([]);
  const [dataSourceLabel, setDataSourceLabel] = useState<string>('Inicializando...');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSat, setSelectedSat] = useState<OrbitalElements | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(false);

  // Observador (RF-03, Sección 4.5)
  const [observer, setObserver] = useState<ObserverLocation>(PRESET_LOCATIONS[0]);
  const [gpsStatusMsg, setGpsStatusMsg] = useState<string>('');

  // Estado orbital en tiempo real, Ground Track y Footprint (RF-02, RF-10, RF-11, RF-12)
  const [realtimeState, setRealtimeState] = useState<SatelliteRealtimeState | null>(null);
  const [groundTrack, setGroundTrack] = useState<GroundTrackSegment[]>([]);
  const [footprint, setFootprint] = useState<FootprintGeometry | null>(null);
  const [minElevationDeg, setMinElevationDeg] = useState<number>(10);

  // Capa de constelación Starlink simultánea (RF-13)
  const [showConstellationLayer, setShowConstellationLayer] = useState<boolean>(false);
  const [constellationLimit, setConstellationLimit] = useState<number>(36);
  const [starlinkCatalog, setStarlinkCatalog] = useState<OrbitalElements[]>([]);
  const [constellationStates, setConstellationStates] = useState<SatelliteRealtimeState[]>([]);
  const lastConstellationUpdateRef = useRef<number>(0);

  // Predicción de pases y notificaciones (RF-04, RF-05, RF-06)
  const [passes, setPasses] = useState<PassWindow[]>([]);
  const [selectedPass, setSelectedPass] = useState<PassWindow | null>(null);
  const [loadingPasses, setLoadingPasses] = useState<boolean>(false);
  const [leadMinutes, setLeadMinutes] = useState<number>(10);
  const [scheduledAlerts, setScheduledAlerts] = useState<ScheduledAlertItem[]>([]);
  const [bannerAlertMsg, setBannerAlertMsg] = useState<string | null>(null);

  // Validación cruzada y diagnóstico de APIs (RF-14, RF-15)
  const [validationResults, setValidationResults] = useState<ValidationComparisonResult[]>([]);
  const [validating, setValidating] = useState<boolean>(false);
  const [validationErrorMsg, setValidationErrorMsg] = useState<string | null>(null);
  const [providerLogs, setProviderLogs] = useState<ProviderEventLog[]>([]);
  const [simulateFailure, setSimulateFailure] = useState<boolean>(false);

  // Configuración de credenciales seguras / Proxy Node.js
  const [proxyUrlInput, setProxyUrlInput] = useState<string>('http://localhost:3001');
  const [n2yoKeyInput, setN2yoKeyInput] = useState<string>('');
  const [stUserInput, setStUserInput] = useState<string>('');
  const [stPassInput, setStPassInput] = useState<string>('');
  const [credsSavedMsg, setCredsSavedMsg] = useState<string>('');

  // Cargar credenciales guardadas y registrar Background Fetch al iniciar
  useEffect(() => {
    (async () => {
      const creds = await credentialStore.getCredentials();
      if (creds.proxyBaseUrl) setProxyUrlInput(creds.proxyBaseUrl);
      if (creds.n2yoApiKey) setN2yoKeyInput(creds.n2yoApiKey);
      if (creds.spaceTrackIdentity) setStUserInput(creds.spaceTrackIdentity);
      if (creds.spaceTrackPassword) setStPassInput(creds.spaceTrackPassword);
      await notificationService.registerBackgroundRefreshTask();
    })();
  }, []);

  // Carga del catálogo por categoría (RF-01, RF-08, RF-09, RF-14)
  const loadCategoryCatalog = useCallback(
    async (category: ConstellationCategory, forceRefresh: boolean = false) => {
      setLoadingCatalog(true);
      try {
        const res = await dataOrchestrator.getCatalog(category, { forceRefresh });
        setCatalog(res.items);
        setDataSourceLabel(res.source);
        setProviderLogs([...dataOrchestrator.getLogs()]);
        if (res.items.length > 0) {
          setSelectedSat((prev) => {
            if (prev && res.items.some((i) => i.noradId === prev.noradId)) {
              return res.items.find((i) => i.noradId === prev.noradId) || res.items[0];
            }
            return res.items[0];
          });
        }
        if (category === 'starlink') {
          setStarlinkCatalog(res.items);
        }
      } finally {
        setLoadingCatalog(false);
      }
    },
    []
  );

  useEffect(() => {
    loadCategoryCatalog(selectedCategory, false);
  }, [selectedCategory, loadCategoryCatalog]);

  // Pre-cargar constelación Starlink cuando el usuario activa la capa multi-satélite (RF-13)
  useEffect(() => {
    if (showConstellationLayer && starlinkCatalog.length === 0) {
      dataOrchestrator.getCatalog('starlink').then((res) => {
        setStarlinkCatalog(res.items);
        setProviderLogs([...dataOrchestrator.getLogs()]);
      });
    }
  }, [showConstellationLayer, starlinkCatalog.length]);

  // Filtrado de búsqueda por nombre o NORAD ID (RF-01)
  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (s) => s.name.toLowerCase().includes(q) || String(s.noradId).includes(q)
    );
  }, [catalog, searchQuery]);

  // Buscar directamente por NORAD ID en CelesTrak/Fallback si no está en la lista actual
  const handleRemoteNoradSearch = async () => {
    const parsed = Number(searchQuery.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) return;
    setLoadingCatalog(true);
    try {
      const sat = await dataOrchestrator.getOrbitalData(parsed, false);
      setCatalog((prev) => (prev.some((p) => p.noradId === sat.noradId) ? prev : [sat, ...prev]));
      setSelectedSat(sat);
      setProviderLogs([...dataOrchestrator.getLogs()]);
    } catch (err) {
      setBannerAlertMsg(err instanceof Error ? err.message : 'No se encontró el NORAD ID');
    } finally {
      setLoadingCatalog(false);
    }
  };

  // Loop de propagación SGP4 en tiempo real (cada 1.5 s) + Throttling para capa de constelación (RF-02, RF-03, RF-10, RF-12, RF-13)
  useEffect(() => {
    if (!selectedSat) return;

    const updatePositions = () => {
      const now = Date.now();
      const state = orbitalEngine.propagateRealtimeState(
        selectedSat,
        observer,
        now,
        minElevationDeg
      );
      if (state) {
        setRealtimeState(state);
        const fp = orbitalEngine.computeFootprint(
          state.latitude,
          state.longitude,
          state.altitudeKm,
          minElevationDeg
        );
        setFootprint(fp);
      }

      // Throttling: actualizar capa de constelación cada 3 segundos fuera del frame crítico (Sección 4.4 / RF-13)
      if (showConstellationLayer && starlinkCatalog.length > 0) {
        if (now - lastConstellationUpdateRef.current >= 3000) {
          lastConstellationUpdateRef.current = now;
          const batch = orbitalEngine.propagateConstellationBatch(
            starlinkCatalog,
            observer,
            now,
            constellationLimit,
            minElevationDeg
          );
          setConstellationStates(batch);
        }
      }
    };

    updatePositions();
    const gt = orbitalEngine.computeGroundTrack(selectedSat, Date.now());
    setGroundTrack(gt);

    const timer = setInterval(updatePositions, 1500);
    return () => clearInterval(timer);
  }, [
    selectedSat,
    observer,
    minElevationDeg,
    showConstellationLayer,
    starlinkCatalog,
    constellationLimit,
  ]);

  // Recalcular ventanas de visibilidad (AOS/MAX/LOS) cuando cambia el satélite, el observador o la elevación mínima (RF-04)
  useEffect(() => {
    if (!selectedSat) return;
    let cancelled = false;
    setLoadingPasses(true);

    passPredictor
      .predictPasses(selectedSat, observer, Date.now(), {
        horizonHours: 24,
        minElevationDeg,
        maxPasses: 8,
      })
      .then((computed) => {
        if (!cancelled) {
          setPasses(computed);
          setSelectedPass(computed[0] || null);
          setLoadingPasses(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingPasses(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSat, observer, minElevationDeg]);

  // Obtener GPS del dispositivo (Sección 4.5)
  const handleUseDeviceGps = async () => {
    setGpsStatusMsg('Obteniendo señal GPS...');
    try {
      const loc = await observerService.getCurrentGpsLocation();
      setObserver(loc);
      setGpsStatusMsg(`GPS activo (${loc.latitude.toFixed(4)}°, ${loc.longitude.toFixed(4)}°)`);
    } catch (err) {
      setGpsStatusMsg(err instanceof Error ? err.message : 'Error al obtener GPS');
    }
  };

  // Programar recordatorio de pase (RF-06)
  const handleScheduleNotification = async (pass: PassWindow) => {
    const alertItem = await notificationService.schedulePassReminder(pass, leadMinutes);
    setScheduledAlerts([...notificationService.getScheduledAlerts()]);
    setBannerAlertMsg(
      `🔔 Recordatorio programado ${leadMinutes} min antes del pase de ${pass.satelliteName} (AOS ${new Date(pass.aosTime).toLocaleTimeString()})`
    );
    setTimeout(() => setBannerAlertMsg(null), 6000);
    return alertItem;
  };

  // Disparar notificación inmediata para el Video Demo (Sección 6)
  const handleTriggerDemoNotification = async () => {
    const targetPass: PassWindow =
      selectedPass ||
      ({
        id: `demo-${Date.now()}`,
        noradId: selectedSat?.noradId || 25544,
        satelliteName: selectedSat?.name || 'ISS (ZARYA)',
        aosTime: Date.now() + 5 * 60_000,
        aosAzimuthDeg: 215,
        maxTime: Date.now() + 8 * 60_000,
        maxElevationDeg: 64.5,
        maxAzimuthDeg: 140,
        minRangeKm: 485,
        losTime: Date.now() + 11 * 60_000,
        losAzimuthDeg: 58,
        durationSeconds: 360,
        minElevationThresholdDeg: minElevationDeg,
        trajectory: [],
      } as PassWindow);

    await notificationService.triggerInstantDemoNotification(targetPass);
    setBannerAlertMsg(
      `🛰️ [NOTIFICACIÓN DISPARADA] ${targetPass.satelliteName} — Pase visible próximo (Elev. Máx: ${targetPass.maxElevationDeg.toFixed(1)}°, Azimut AOS: ${targetPass.aosAzimuthDeg.toFixed(0)}°)`
    );
  };

  // Ejecutar validación cruzada contra Where the ISS at? o N2YO (RF-15)
  const handleRunValidation = async (provider: 'wheretheiss' | 'n2yo') => {
    if (!selectedSat) return;
    setValidating(true);
    setValidationErrorMsg(null);
    try {
      let targetElement = selectedSat;
      if (provider === 'wheretheiss' && selectedSat.noradId !== 25544) {
        targetElement = await dataOrchestrator.getOrbitalData(25544, false);
      }
      const res = await validationService.validateSatellitePosition(
        targetElement,
        observer,
        provider
      );
      setValidationResults([...validationService.getHistory()]);
      setProviderLogs([...dataOrchestrator.getLogs()]);
      setBannerAlertMsg(
        `✅ Validación exitosa contra ${provider.toUpperCase()}: Error superficial = ${res.surfaceErrorKm.toFixed(2)} km (Error 3D = ${res.spatial3dErrorKm.toFixed(2)} km)`
      );
    } catch (err) {
      setValidationErrorMsg(err instanceof Error ? err.message : 'Error durante la validación');
    } finally {
      setValidating(false);
    }
  };

  const handleSaveCredentials = async () => {
    await credentialStore.saveCredentials({
      proxyBaseUrl: proxyUrlInput,
      n2yoApiKey: n2yoKeyInput,
      spaceTrackIdentity: stUserInput,
      spaceTrackPassword: stPassInput,
    });
    setCredsSavedMsg('✅ Configuración guardada en almacenamiento seguro (SecureStore)');
    setTimeout(() => setCredsSavedMsg(''), 4000);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />

      {/* Encabezado Principal */}
      <View style={styles.topHeader}>
        <View>
          <Text style={styles.appTitle}>🛰️ SATELLITE TRACKER • SGP4</Text>
          <Text style={styles.appSubtitle}>
            TP7 Programación Móviles • Fuente: {dataSourceLabel}
          </Text>
        </View>
        {realtimeState && (
          <View
            style={[
              styles.epochBadge,
              realtimeState.isEpochStale ? styles.epochBadgeStale : styles.epochBadgeFresh,
            ]}
          >
            <Text style={styles.epochBadgeText}>
              {realtimeState.isEpochStale ? '⚠️ TLE Desactualizado' : '✓ Efeméride Vigente'} (
              {realtimeState.epochAgeHours.toFixed(1)}h)
            </Text>
          </View>
        )}
      </View>

      {/* Banner de Notificaciones / Eventos en Vivo */}
      {bannerAlertMsg && (
        <TouchableOpacity
          style={styles.notificationBanner}
          onPress={() => setBannerAlertMsg(null)}
        >
          <Text style={styles.notificationBannerText}>{bannerAlertMsg}</Text>
          <Text style={styles.notificationDismiss}>✕</Text>
        </TouchableOpacity>
      )}

      {/* Alerta de antigüedad de datos orbitales (RF-16) */}
      {realtimeState?.isEpochStale && (
        <View style={styles.staleWarningBar}>
          <Text style={styles.staleWarningText}>
            ⚠️ Los datos orbitales tienen {realtimeState.epochAgeHours.toFixed(1)} h de antigüedad
            (&gt; 24 h). La precisión SGP4 puede degradarse.
          </Text>
          <TouchableOpacity
            style={styles.refreshNowMiniBtn}
            onPress={() => loadCategoryCatalog(selectedCategory, true)}
          >
            <Text style={styles.refreshNowMiniText}>Actualizar</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Barra de Navegación por Pestañas */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'map' && styles.tabItemActive]}
          onPress={() => setActiveTab('map')}
        >
          <Text style={[styles.tabText, activeTab === 'map' && styles.tabTextActive]}>
            🌍 Mapa & SGP4
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'passes' && styles.tabItemActive]}
          onPress={() => setActiveTab('passes')}
        >
          <Text style={[styles.tabText, activeTab === 'passes' && styles.tabTextActive]}>
            🔭 Pases ({passes.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'compass' && styles.tabItemActive]}
          onPress={() => setActiveTab('compass')}
        >
          <Text style={[styles.tabText, activeTab === 'compass' && styles.tabTextActive]}>
            🧭 Brújula
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'validation' && styles.tabItemActive]}
          onPress={() => setActiveTab('validation')}
        >
          <Text style={[styles.tabText, activeTab === 'validation' && styles.tabTextActive]}>
            ✅ Validación
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.mainScroll} contentContainerStyle={styles.scrollContent}>
        {/* Selector de Categorías / Constelaciones (RF-08) y Buscador (RF-01) */}
        <View style={styles.selectorCard}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryChip,
                  selectedCategory === cat.id && styles.categoryChipActive,
                ]}
                onPress={() => setSelectedCategory(cat.id)}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    selectedCategory === cat.id && styles.categoryChipTextActive,
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar por nombre (ej. ISS, STARLINK, ARSAT) o NORAD ID..."
              placeholderTextColor="#64748b"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.trim().length > 0 && (
              <TouchableOpacity style={styles.remoteSearchBtn} onPress={handleRemoteNoradSearch}>
                <Text style={styles.remoteSearchBtnText}>Buscar ID</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.refreshBtn}
              onPress={() => loadCategoryCatalog(selectedCategory, true)}
            >
              <Text style={styles.refreshBtnText}>{loadingCatalog ? '...' : '↻'}</Text>
            </TouchableOpacity>
          </View>

          {/* Lista horizontal de satélites del catálogo filtrado */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.satListScroll}>
            {filteredCatalog.slice(0, 40).map((item) => {
              const isSelected = selectedSat?.noradId === item.noradId;
              return (
                <TouchableOpacity
                  key={item.noradId}
                  style={[styles.satPill, isSelected && styles.satPillActive]}
                  onPress={() => setSelectedSat(item)}
                >
                  <Text style={[styles.satPillName, isSelected && styles.satPillNameActive]}>
                    {item.name}
                  </Text>
                  <Text style={styles.satPillNorad}>NORAD {item.noradId}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ===================== PESTAÑA 1: MAPA MUNDIAL & TELEMETRÍA SGP4 ===================== */}
        {activeTab === 'map' && (
          <>
            <WorldMapView
              selectedSatellite={realtimeState}
              observer={observer}
              groundTrack={groundTrack}
              footprint={footprint}
              constellationStates={constellationStates}
              showConstellation={showConstellationLayer}
              onSelectConstellationSat={(noradId) => {
                const found = starlinkCatalog.find((s) => s.noradId === noradId);
                if (found) setSelectedSat(found);
              }}
            />

            {/* Controles de Footprint (RF-12) y Capa de Constelación Starlink (RF-13) */}
            <View style={styles.controlsCard}>
              <View style={styles.controlRowBetween}>
                <Text style={styles.controlLabel}>
                  Elevación Mínima (ε_min): {minElevationDeg}° • Radio Footprint:{' '}
                  {footprint ? `${footprint.surfaceRadiusKm.toFixed(0)} km` : '--'}
                </Text>
                <View style={styles.pillGroup}>
                  {[0, 5, 10, 15, 25].map((deg) => (
                    <TouchableOpacity
                      key={deg}
                      style={[
                        styles.miniOptionBtn,
                        minElevationDeg === deg && styles.miniOptionBtnActive,
                      ]}
                      onPress={() => setMinElevationDeg(deg)}
                    >
                      <Text style={styles.miniOptionText}>{deg}°</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={[styles.controlRowBetween, { marginTop: 10 }]}>
                <TouchableOpacity
                  style={[
                    styles.constellationToggleBtn,
                    showConstellationLayer && styles.constellationToggleBtnActive,
                  ]}
                  onPress={() => setShowConstellationLayer((v) => !v)}
                >
                  <Text style={styles.constellationToggleText}>
                    {showConstellationLayer
                      ? `✨ Capa Constelación Starlink Activa (${constellationStates.length} sats)`
                      : '✨ Mostrar Capa Constelación Starlink (RF-13)'}
                  </Text>
                </TouchableOpacity>

                {showConstellationLayer && (
                  <View style={styles.pillGroup}>
                    {[20, 36, 60].map((lim) => (
                      <TouchableOpacity
                        key={lim}
                        style={[
                          styles.miniOptionBtn,
                          constellationLimit === lim && styles.miniOptionBtnActive,
                        ]}
                        onPress={() => setConstellationLimit(lim)}
                      >
                        <Text style={styles.miniOptionText}>Máx {lim}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </View>

            {/* Panel de Telemetría Orbital en Tiempo Real (RF-02, RF-03, RF-16) */}
            {realtimeState && (
              <View style={styles.telemetryCard}>
                <View style={styles.telemetryHeader}>
                  <View>
                    <Text style={styles.telemetryTitle}>
                      {realtimeState.name} (NORAD {realtimeState.noradId})
                    </Text>
                    <Text style={styles.telemetrySub}>
                      Régimen: {realtimeState.orbitRegime} • Período:{' '}
                      {realtimeState.periodMinutes.toFixed(1)} min • Formato:{' '}
                      {selectedSat?.omm ? 'OMM/JSON (CCSDS V3)' : 'TLE'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.visibilityTag,
                      realtimeState.isVisible ? styles.visTagAbove : styles.visTagBelow,
                    ]}
                  >
                    <Text style={styles.visibilityTagText}>
                      {realtimeState.isVisible ? 'VISIBLE DESDE OBS' : 'BAJO UMBRAL'}
                    </Text>
                  </View>
                </View>

                <View style={styles.telemetryGrid}>
                  <View style={styles.telemetryCell}>
                    <Text style={styles.telemetryLabel}>Latitud Subsatelital</Text>
                    <Text style={styles.telemetryValue}>{realtimeState.latitude.toFixed(4)}°</Text>
                  </View>
                  <View style={styles.telemetryCell}>
                    <Text style={styles.telemetryLabel}>Longitud Subsatelital</Text>
                    <Text style={styles.telemetryValue}>{realtimeState.longitude.toFixed(4)}°</Text>
                  </View>
                  <View style={styles.telemetryCell}>
                    <Text style={styles.telemetryLabel}>Altitud Geodésica</Text>
                    <Text style={styles.telemetryValue}>
                      {realtimeState.altitudeKm.toFixed(1)} km
                    </Text>
                  </View>
                  <View style={styles.telemetryCell}>
                    <Text style={styles.telemetryLabel}>Velocidad Orbital</Text>
                    <Text style={styles.telemetryValue}>
                      {realtimeState.velocityKmS.toFixed(2)} km/s
                    </Text>
                  </View>
                  <View style={styles.telemetryCell}>
                    <Text style={styles.telemetryLabel}>Azimut (Observador)</Text>
                    <Text style={[styles.telemetryValue, { color: '#38bdf8' }]}>
                      {realtimeState.azimuthDeg.toFixed(1)}°
                    </Text>
                  </View>
                  <View style={styles.telemetryCell}>
                    <Text style={styles.telemetryLabel}>Elevación (Observador)</Text>
                    <Text
                      style={[
                        styles.telemetryValue,
                        { color: realtimeState.elevationDeg >= 0 ? '#4ade80' : '#f87171' },
                      ]}
                    >
                      {realtimeState.elevationDeg.toFixed(1)}°
                    </Text>
                  </View>
                  <View style={styles.telemetryCell}>
                    <Text style={styles.telemetryLabel}>Distancia Directa (Slant)</Text>
                    <Text style={styles.telemetryValue}>{realtimeState.rangeKm.toFixed(0)} km</Text>
                  </View>
                  <View style={styles.telemetryCell}>
                    <Text style={styles.telemetryLabel}>Iluminación Solar / Sombra</Text>
                    <Text style={styles.telemetryValue}>{realtimeState.illumination}</Text>
                  </View>
                  <View style={styles.telemetryCell}>
                    <Text style={styles.telemetryLabel}>Factor Doppler (RF Link)</Text>
                    <Text style={styles.telemetryValue}>
                      {realtimeState.dopplerFactor.toFixed(7)}
                    </Text>
                  </View>
                  <View style={styles.telemetryCell}>
                    <Text style={styles.telemetryLabel}>Segmentos Ground Track</Text>
                    <Text style={styles.telemetryValue}>
                      {groundTrack.length} (Antimeridiano OK)
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </>
        )}

        {/* ===================== PESTAÑA 2: PASES DE VISIBILIDAD & SKY CHART (RF-04, RF-05, RF-06) ===================== */}
        {activeTab === 'passes' && (
          <>
            <SkyChartPolar
              pass={selectedPass}
              realtimeState={realtimeState}
              minElevationDeg={minElevationDeg}
            />

            <View style={styles.controlsCard}>
              <View style={styles.controlRowBetween}>
                <View>
                  <Text style={styles.sectionTitle}>
                    Recordatorios de Pase y Demo de Notificación (RF-06)
                  </Text>
                  <Text style={styles.controlLabel}>
                    Avisar {leadMinutes} min antes del AOS • Estación: {observer.label}
                  </Text>
                </View>
                <View style={styles.pillGroup}>
                  {[5, 10, 15].map((min) => (
                    <TouchableOpacity
                      key={min}
                      style={[
                        styles.miniOptionBtn,
                        leadMinutes === min && styles.miniOptionBtnActive,
                      ]}
                      onPress={() => setLeadMinutes(min)}
                    >
                      <Text style={styles.miniOptionText}>{min}m</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity
                style={styles.demoNotifyBtn}
                onPress={handleTriggerDemoNotification}
              >
                <Text style={styles.demoNotifyBtnText}>
                  ⚡ Disparar Notificación de Pase Ahora (Para Video Demo)
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.passesCard}>
              <Text style={styles.sectionTitle}>
                Próximas Ventanas de Visibilidad (24 h • ε ≥ {minElevationDeg}°)
              </Text>
              {loadingPasses ? (
                <ActivityIndicator color="#38bdf8" style={{ marginVertical: 16 }} />
              ) : passes.length === 0 ? (
                <Text style={styles.emptyText}>
                  No hay pases con elevación ≥ {minElevationDeg}° en las próximas 24 h para esta
                  ubicación. Probá reducir ε_min a 0° o 5°.
                </Text>
              ) : (
                passes.map((p) => {
                  const isSelected = selectedPass?.id === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.passRow, isSelected && styles.passRowActive]}
                      onPress={() => setSelectedPass(p)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.passTitle}>
                          {new Date(p.aosTime).toLocaleDateString()} • AOS{' '}
                          {new Date(p.aosTime).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </Text>
                        <Text style={styles.passMeta}>
                          AOS Az: {p.aosAzimuthDeg.toFixed(0)}° → MAX:{' '}
                          <Text style={{ color: '#facc15', fontWeight: '700' }}>
                            {p.maxElevationDeg.toFixed(1)}°
                          </Text>{' '}
                          (Az {p.maxAzimuthDeg.toFixed(0)}°) → LOS:{' '}
                          {new Date(p.losTime).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}{' '}
                          (Az {p.losAzimuthDeg.toFixed(0)}°)
                        </Text>
                        <Text style={styles.passDuration}>
                          Duración: {Math.floor(p.durationSeconds / 60)}m {p.durationSeconds % 60}s
                          • Rango mín: {p.minRangeKm.toFixed(0)} km
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.notifyPassBtn}
                        onPress={() => handleScheduleNotification(p)}
                      >
                        <Text style={styles.notifyPassBtnText}>🔔 -{leadMinutes}m</Text>
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })
              )}

              {scheduledAlerts.length > 0 && (
                <View style={styles.scheduledBox}>
                  <Text style={styles.controlLabel}>
                    Recordatorios programados ({scheduledAlerts.length}):
                  </Text>
                  {scheduledAlerts.slice(0, 4).map((al) => (
                    <Text key={al.notificationId} style={styles.scheduledItemText}>
                      • {al.satelliteName}: aviso {al.leadMinutes} min antes de{' '}
                      {new Date(al.aosTime).toLocaleTimeString()}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          </>
        )}

        {/* ===================== PESTAÑA 3: MODO BRÚJULA & ESTACIÓN TERRENA (RF-07) ===================== */}
        {activeTab === 'compass' && (
          <>
            <CompassOverlay satelliteState={realtimeState} />

            <View style={styles.controlsCard}>
              <Text style={styles.sectionTitle}>
                Ubicación del Observador / Estación Terrena (RF-03)
              </Text>
              <Text style={styles.controlLabel}>
                Actual: {observer.label} ({observer.latitude.toFixed(4)}°,{' '}
                {observer.longitude.toFixed(4)}°, Alt {observer.altitudeMeters}m)
              </Text>
              {gpsStatusMsg ? <Text style={styles.gpsStatusText}>{gpsStatusMsg}</Text> : null}

              <TouchableOpacity style={styles.gpsBtn} onPress={handleUseDeviceGps}>
                <Text style={styles.gpsBtnText}>📍 Obtener Mi Ubicación GPS en Vivo</Text>
              </TouchableOpacity>

              <Text style={[styles.controlLabel, { marginTop: 10, marginBottom: 6 }]}>
                O seleccionar estación terrena de referencia:
              </Text>
              {PRESET_LOCATIONS.map((loc) => (
                <TouchableOpacity
                  key={loc.label}
                  style={[
                    styles.presetLocBtn,
                    observer.label === loc.label && styles.presetLocBtnActive,
                  ]}
                  onPress={() => setObserver(loc)}
                >
                  <Text style={styles.presetLocText}>{loc.label}</Text>
                  <Text style={styles.presetLocCoords}>
                    {loc.latitude.toFixed(2)}°, {loc.longitude.toFixed(2)}°
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* ===================== PESTAÑA 4: MODO VALIDACIÓN & ARQUITECTURA DE DATOS (RF-14, RF-15) ===================== */}
        {activeTab === 'validation' && (
          <>
            <View style={styles.controlsCard}>
              <Text style={styles.sectionTitle}>
                Modo Validación Cruzada: SGP4 Local vs. Fuentes Externas (RF-15)
              </Text>
              <Text style={styles.controlLabel}>
                Compara en el mismo instante la posición calculada por satellite.js contra Where the
                ISS at? (NORAD 25544) y N2YO (cualquier satélite), midiendo el error geodésico en km.
              </Text>

              <View style={styles.validationActionsRow}>
                <TouchableOpacity
                  style={styles.validateIssBtn}
                  onPress={() => handleRunValidation('wheretheiss')}
                  disabled={validating}
                >
                  <Text style={styles.validateBtnText}>
                    {validating
                      ? 'Validando...'
                      : '🛰️ Validar ISS contra WhereTheISS API (Sin Clave)'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.validateN2yoBtn}
                  onPress={() => handleRunValidation('n2yo')}
                  disabled={validating}
                >
                  <Text style={styles.validateBtnText}>
                    🔍 Validar {selectedSat?.name || 'Satélite'} contra N2YO API
                  </Text>
                </TouchableOpacity>
              </View>

              {validationErrorMsg && (
                <Text style={styles.errorText}>⚠️ {validationErrorMsg}</Text>
              )}

              {validationResults.length > 0 && (
                <View style={styles.validationTable}>
                  <Text style={[styles.sectionTitle, { marginTop: 10 }]}>
                    Tabla de Mediciones de Error Registradas
                  </Text>
                  {validationResults.map((vr) => (
                    <View key={vr.id} style={styles.validationResultRow}>
                      <View style={styles.controlRowBetween}>
                        <Text style={styles.valSatTitle}>
                          {vr.satelliteName} (#{vr.noradId}) vs. {vr.providerCompared.toUpperCase()}
                        </Text>
                        <Text style={styles.valErrorBadge}>
                          Error 2D: {vr.surfaceErrorKm.toFixed(2)} km | 3D:{' '}
                          {vr.spatial3dErrorKm.toFixed(2)} km
                        </Text>
                      </View>
                      <Text style={styles.valDetailText}>
                        • SGP4 Local: Lat {vr.local.latitude.toFixed(4)}°, Lon{' '}
                        {vr.local.longitude.toFixed(4)}°, Alt {vr.local.altitudeKm.toFixed(2)} km
                      </Text>
                      <Text style={styles.valDetailText}>
                        • API Externa: Lat {vr.external.latitude.toFixed(4)}°, Lon{' '}
                        {vr.external.longitude.toFixed(4)}°, Alt{' '}
                        {vr.external.altitudeKm.toFixed(2)} km
                      </Text>
                      <Text style={styles.valDetailText}>
                        • Dif. Altitud: {vr.altitudeErrorKm.toFixed(2)} km • Antigüedad Epoch:{' '}
                        {vr.epochAgeHours.toFixed(2)} h • Hora:{' '}
                        {new Date(vr.timestamp).toLocaleTimeString()}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Resiliencia, Rate Limits y Simulación de Fallback (RF-09, RF-14) */}
            <View style={styles.controlsCard}>
              <Text style={styles.sectionTitle}>
                Orquestador de Proveedores, Rate Limiter y Fallback (RF-14)
              </Text>
              <TouchableOpacity
                style={[
                  styles.fallbackSimBtn,
                  simulateFailure && styles.fallbackSimBtnActive,
                ]}
                onPress={() => {
                  const next = !simulateFailure;
                  setSimulateFailure(next);
                  dataOrchestrator.setSimulatePrimaryFailure(next);
                  setProviderLogs([...dataOrchestrator.getLogs()]);
                }}
              >
                <Text style={styles.fallbackSimText}>
                  {simulateFailure
                    ? '🔥 Simulación de Caída de CelesTrak ACTIVA (Probando Fallback Automático)'
                    : '🧪 Simular Caída de CelesTrak para Probar Fallback Automático'}
                </Text>
              </TouchableOpacity>

              <View style={styles.quotaList}>
                {rateLimiter.getAllQuotas().map((q) => (
                  <View key={q.provider} style={styles.quotaBadge}>
                    <Text style={styles.quotaTitle}>{q.provider.toUpperCase()}</Text>
                    <Text style={styles.quotaVal}>
                      {q.requestsLastMinute}/{q.maxPerMinute} req/min • {q.requestsLastHour}/
                      {q.maxPerHour} req/h
                    </Text>
                  </View>
                ))}
              </View>

              <TouchableOpacity
                style={styles.clearCacheBtn}
                onPress={async () => {
                  await orbitalCache.clearAll();
                  await loadCategoryCatalog(selectedCategory, true);
                }}
              >
                <Text style={styles.clearCacheBtnText}>
                  🗑️ Purgar Caché Local (TTL) y Recargar desde Proveedor Activo
                </Text>
              </TouchableOpacity>

              <Text style={[styles.controlLabel, { marginTop: 10 }]}>
                Bitácora del Orquestador de Datos:
              </Text>
              {providerLogs.slice(0, 6).map((log) => (
                <Text key={log.id} style={styles.logLine}>
                  [{new Date(log.timestamp).toLocaleTimeString()}] [{log.provider.toUpperCase()}]{' '}
                  {log.detail}
                </Text>
              ))}
            </View>

            {/* Configuración de Credenciales Seguras y Proxy Node.js (Sección 4.3) */}
            <View style={styles.controlsCard}>
              <Text style={styles.sectionTitle}>
                Credenciales Seguras (SecureStore) & Backend Proxy (Sección 4.3)
              </Text>
              <Text style={styles.controlLabel}>
                URL del Proxy Node.js (`c:\tp7\server`):
              </Text>
              <TextInput
                style={styles.credInput}
                value={proxyUrlInput}
                onChangeText={setProxyUrlInput}
                placeholder="http://localhost:3001"
                placeholderTextColor="#64748b"
              />
              <Text style={styles.controlLabel}>API Key de N2YO (Opcional si usa Proxy):</Text>
              <TextInput
                style={styles.credInput}
                value={n2yoKeyInput}
                onChangeText={setN2yoKeyInput}
                placeholder="Ingresar N2YO API Key..."
                placeholderTextColor="#64748b"
                secureTextEntry
              />
              <Text style={styles.controlLabel}>Usuario Space-Track.org (Opcional):</Text>
              <TextInput
                style={styles.credInput}
                value={stUserInput}
                onChangeText={setStUserInput}
                placeholder="identity@email.com"
                placeholderTextColor="#64748b"
              />
              <Text style={styles.controlLabel}>Contraseña Space-Track.org:</Text>
              <TextInput
                style={styles.credInput}
                value={stPassInput}
                onChangeText={setStPassInput}
                placeholder="********"
                placeholderTextColor="#64748b"
                secureTextEntry
              />
              <TouchableOpacity style={styles.saveCredsBtn} onPress={handleSaveCredentials}>
                <Text style={styles.saveCredsBtnText}>Guardar en Almacenamiento Seguro</Text>
              </TouchableOpacity>
              {credsSavedMsg ? <Text style={styles.savedConfirm}>{credsSavedMsg}</Text> : null}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#050b14',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0a1220',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    flexWrap: 'wrap',
    gap: 8,
  },
  appTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  appSubtitle: {
    color: '#38bdf8',
    fontSize: 11,
    marginTop: 2,
  },
  epochBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  epochBadgeFresh: {
    backgroundColor: 'rgba(34, 197, 94, 0.14)',
    borderColor: '#22c55e',
  },
  epochBadgeStale: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderColor: '#f59e0b',
  },
  epochBadgeText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
  },
  notificationBanner: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  notificationBannerText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  notificationDismiss: {
    color: '#e0f2fe',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 10,
  },
  staleWarningBar: {
    backgroundColor: 'rgba(234, 179, 8, 0.18)',
    borderBottomWidth: 1,
    borderBottomColor: '#eab308',
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  staleWarningText: {
    color: '#fef08a',
    fontSize: 11,
    flex: 1,
  },
  refreshNowMiniBtn: {
    backgroundColor: '#eab308',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginLeft: 8,
  },
  refreshNowMiniText: {
    color: '#0f172a',
    fontSize: 11,
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  tabItem: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: '#38bdf8',
    backgroundColor: '#132038',
  },
  tabText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  mainScroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 12,
    gap: 12,
    paddingBottom: 36,
  },
  selectorCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    gap: 8,
  },
  categoryScroll: {
    flexDirection: 'row',
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#1e293b',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  categoryChipActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  categoryChipText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#07111e',
    color: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  remoteSearchBtn: {
    backgroundColor: '#0369a1',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  remoteSearchBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  refreshBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  refreshBtnText: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '700',
  },
  satListScroll: {
    flexDirection: 'row',
  },
  satPill: {
    backgroundColor: '#07111e',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  satPillActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#0c2d48',
  },
  satPillName: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  satPillNameActive: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  satPillNorad: {
    color: '#64748b',
    fontSize: 10,
  },
  controlsCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  controlRowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  controlLabel: {
    color: '#94a3b8',
    fontSize: 12,
  },
  pillGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  miniOptionBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  miniOptionBtnActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  miniOptionText: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '600',
  },
  constellationToggleBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
  },
  constellationToggleBtnActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderColor: '#f59e0b',
  },
  constellationToggleText: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '700',
  },
  telemetryCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  telemetryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    flexWrap: 'wrap',
    gap: 6,
  },
  telemetryTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '800',
  },
  telemetrySub: {
    color: '#38bdf8',
    fontSize: 11,
    marginTop: 2,
  },
  visibilityTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  visTagAbove: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  visTagBelow: {
    backgroundColor: '#1e293b',
  },
  visibilityTagText: {
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: '700',
  },
  telemetryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  telemetryCell: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#07111e',
    padding: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  telemetryLabel: {
    color: '#64748b',
    fontSize: 11,
  },
  telemetryValue: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  demoNotifyBtn: {
    marginTop: 10,
    backgroundColor: '#0284c7',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  demoNotifyBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  passesCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    gap: 8,
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 12,
    paddingVertical: 12,
  },
  passRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#07111e',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    gap: 8,
  },
  passRowActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#0c253d',
  },
  passTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  passMeta: {
    color: '#cbd5e1',
    fontSize: 11,
    marginTop: 3,
  },
  passDuration: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
  },
  notifyPassBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  notifyPassBtnText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
  },
  scheduledBox: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  scheduledItemText: {
    color: '#4ade80',
    fontSize: 11,
    marginTop: 2,
  },
  gpsBtn: {
    marginTop: 8,
    backgroundColor: '#059669',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  gpsBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  gpsStatusText: {
    color: '#38bdf8',
    fontSize: 11,
    marginTop: 4,
  },
  presetLocBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#07111e',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginTop: 6,
  },
  presetLocBtnActive: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  presetLocText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  presetLocCoords: {
    color: '#94a3b8',
    fontSize: 11,
  },
  validationActionsRow: {
    gap: 8,
    marginTop: 10,
  },
  validateIssBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  validateN2yoBtn: {
    backgroundColor: '#4f46e5',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  validateBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    marginTop: 8,
  },
  validationTable: {
    marginTop: 8,
    gap: 8,
  },
  validationResultRow: {
    backgroundColor: '#07111e',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    gap: 4,
  },
  valSatTitle: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  valErrorBadge: {
    color: '#4ade80',
    fontSize: 12,
    fontWeight: '700',
  },
  valDetailText: {
    color: '#cbd5e1',
    fontSize: 11,
  },
  fallbackSimBtn: {
    marginTop: 8,
    backgroundColor: '#1e293b',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
    alignItems: 'center',
  },
  fallbackSimBtnActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: '#ef4444',
  },
  fallbackSimText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '700',
  },
  quotaList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  quotaBadge: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#07111e',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  quotaTitle: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
  },
  quotaVal: {
    color: '#cbd5e1',
    fontSize: 11,
    marginTop: 2,
  },
  clearCacheBtn: {
    marginTop: 10,
    backgroundColor: '#1e293b',
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  clearCacheBtnText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600',
  },
  logLine: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 3,
  },
  credInput: {
    backgroundColor: '#07111e',
    color: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginTop: 4,
    marginBottom: 8,
  },
  saveCredsBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  saveCredsBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  savedConfirm: {
    color: '#4ade80',
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },
});
