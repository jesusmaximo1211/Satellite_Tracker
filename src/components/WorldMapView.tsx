/**
 * Capa de Visualización Geográfica (Geo/Map Layer - RF-10, RF-11, RF-12, RF-13 y Sección 4.4):
 * - Renderiza en tiempo real la posición del satélite seleccionado (refresco cada 1-5 s calculado localmente).
 * - Dibuja el Ground Track pasado y futuro dividido en segmentos al cruzar el antimeridiano (±180°).
 * - Dibuja el Footprint (área de cobertura) según la altitud y elevación mínima configurable.
 * - Muestra la capa de constelación multi-satélite (ej. subconjunto de Starlink) con límite de objetos.
 * - Incluye doble motor de renderizado:
 *   1. Motor Nativo (react-native-maps: MapView, Marker, Polyline, Polygon) para iOS/Android.
 *   2. Planisferio Táctico Vectorial (react-native-svg) para Web o emuladores sin API Key de Google Maps.
 */

import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle as SvgCircle, G, Line, Path, Polyline as SvgPolyline, Rect, Text as SvgText } from 'react-native-svg';
import {
  FootprintGeometry,
  GroundTrackSegment,
  LatLonPoint,
  ObserverLocation,
  SatelliteRealtimeState,
} from '../types/orbital';

// Carga condicional segura de react-native-maps para que no falle en Web
let MapViewComponent: any = null;
let MarkerComponent: any = null;
let PolylineComponent: any = null;
let PolygonComponent: any = null;

if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RNMaps = require('react-native-maps');
    MapViewComponent = RNMaps.default || RNMaps;
    MarkerComponent = RNMaps.Marker;
    PolylineComponent = RNMaps.Polyline;
    PolygonComponent = RNMaps.Polygon;
  } catch {
    MapViewComponent = null;
  }
}

export interface WorldMapViewProps {
  selectedSatellite: SatelliteRealtimeState | null;
  observer: ObserverLocation;
  groundTrack: GroundTrackSegment[];
  footprint: FootprintGeometry | null;
  constellationStates: SatelliteRealtimeState[];
  showConstellation: boolean;
  onSelectConstellationSat?: (noradId: number) => void;
}

const SVG_WIDTH = 720;
const SVG_HEIGHT = 360;

function latLonToSvg(lat: number, lon: number): { x: number; y: number } {
  const x = ((lon + 180) / 360) * SVG_WIDTH;
  const y = ((90 - lat) / 180) * SVG_HEIGHT;
  return { x, y };
}

function pointsToSvgString(points: LatLonPoint[]): string {
  return points
    .map((p) => {
      const { x, y } = latLonToSvg(p.latitude, p.longitude);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

// Contornos continentales simplificados en proyección equirectangular (720x360) para el Planisferio Táctico
const CONTINENT_PATHS = [
  // América del Norte
  'M 45,45 L 155,40 L 210,75 L 195,125 L 155,145 L 140,165 L 105,130 L 65,85 Z',
  // América del Sur (destacando el Cono Sur / Argentina)
  'M 165,170 L 220,185 L 255,215 L 235,275 L 205,325 L 190,320 L 185,255 L 160,205 Z',
  // Europa
  'M 335,55 L 415,48 L 435,85 L 395,112 L 340,108 Z',
  // África
  'M 330,118 L 410,120 L 445,165 L 420,265 L 385,270 L 365,195 L 325,160 Z',
  // Asia
  'M 425,52 L 625,55 L 650,115 L 595,175 L 515,178 L 450,145 L 430,90 Z',
  // Oceanía / Australia
  'M 565,225 L 645,222 L 655,275 L 585,282 L 560,255 Z',
];

export const WorldMapView: React.FC<WorldMapViewProps> = ({
  selectedSatellite,
  observer,
  groundTrack,
  footprint,
  constellationStates,
  showConstellation,
  onSelectConstellationSat,
}) => {
  const [useNativeMap, setUseNativeMap] = useState<boolean>(
    Platform.OS !== 'web' && Boolean(MapViewComponent)
  );

  const obsSvg = latLonToSvg(observer.latitude, observer.longitude);
  const satSvg = selectedSatellite
    ? latLonToSvg(selectedSatellite.latitude, selectedSatellite.longitude)
    : null;

  return (
    <View style={styles.container}>
      <View style={styles.mapHeaderBar}>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#38bdf8' }]} />
          <Text style={styles.legendText}>Órbita Futura (1T)</Text>
          <View style={[styles.legendDot, { backgroundColor: '#94a3b8' }]} />
          <Text style={styles.legendText}>Pasada</Text>
          <View style={[styles.legendDot, { backgroundColor: '#22c55e' }]} />
          <Text style={styles.legendText}>Footprint</Text>
          {showConstellation && (
            <>
              <View style={[styles.legendDot, { backgroundColor: '#f59e0b' }]} />
              <Text style={styles.legendText}>Starlink ({constellationStates.length})</Text>
            </>
          )}
        </View>

        {Platform.OS !== 'web' && MapViewComponent && (
          <TouchableOpacity
            style={styles.modeToggleBtn}
            onPress={() => setUseNativeMap((prev) => !prev)}
          >
            <Text style={styles.modeToggleText}>
              {useNativeMap ? 'Ver Planisferio Táctico' : 'Ver Mapa Nativo'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {useNativeMap && MapViewComponent ? (
        <MapViewComponent
          style={styles.nativeMap}
          initialRegion={{
            latitude: selectedSatellite?.latitude ?? observer.latitude,
            longitude: selectedSatellite?.longitude ?? observer.longitude,
            latitudeDelta: 85,
            longitudeDelta: 120,
          }}
        >
          {/* Segmentos del Ground Track con corte en el antimeridiano (RF-11) */}
          {groundTrack.map((seg) => (
            <PolylineComponent
              key={seg.id}
              coordinates={seg.points}
              strokeColor={seg.isPast ? '#94a3b8' : '#38bdf8'}
              strokeWidth={seg.isPast ? 2 : 3}
              lineDashPattern={seg.isPast ? [6, 4] : undefined}
            />
          ))}

          {/* Footprint / Área de cobertura según altitud y elevación mínima (RF-12) */}
          {footprint &&
            footprint.polygonSegments.map((ring, idx) => (
              <PolygonComponent
                key={`fp-poly-${idx}`}
                coordinates={ring}
                strokeColor="rgba(34, 197, 94, 0.85)"
                fillColor="rgba(34, 197, 94, 0.18)"
                strokeWidth={2}
              />
            ))}

          {/* Capa de Constelación Starlink con límite de objetos (RF-13) */}
          {showConstellation &&
            constellationStates.map((st) => (
              <MarkerComponent
                key={`const-${st.noradId}`}
                coordinate={{ latitude: st.latitude, longitude: st.longitude }}
                title={st.name}
                description={`Alt: ${st.altitudeKm.toFixed(0)} km | El: ${st.elevationDeg.toFixed(1)}°`}
                pinColor="#f59e0b"
                onPress={() => onSelectConstellationSat?.(st.noradId)}
              />
            ))}

          {/* Marcador de la estación del observador */}
          <MarkerComponent
            coordinate={{ latitude: observer.latitude, longitude: observer.longitude }}
            title={observer.label}
            description={`Obs: ${observer.latitude.toFixed(4)}°, ${observer.longitude.toFixed(4)}°`}
            pinColor="#10b981"
          />

          {/* Marcador en tiempo real del satélite seleccionado (RF-10) */}
          {selectedSatellite && (
            <MarkerComponent
              coordinate={{
                latitude: selectedSatellite.latitude,
                longitude: selectedSatellite.longitude,
              }}
              title={`${selectedSatellite.name} (${selectedSatellite.noradId})`}
              description={`Lat: ${selectedSatellite.latitude.toFixed(2)}° Lon: ${selectedSatellite.longitude.toFixed(2)}° Alt: ${selectedSatellite.altitudeKm.toFixed(1)} km`}
              pinColor="#ef4444"
            />
          )}
        </MapViewComponent>
      ) : (
        <View style={styles.svgMapWrapper}>
          <Svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} style={styles.svgCanvas}>
            {/* Fondo oceánico oscuro */}
            <Rect x={0} y={0} width={SVG_WIDTH} height={SVG_HEIGHT} fill="#07111e" />

            {/* Grilla de meridianos y paralelos cada 30° */}
            {[-60, -30, 0, 30, 60].map((lat) => {
              const { y } = latLonToSvg(lat, 0);
              return (
                <Line
                  key={`lat-${lat}`}
                  x1={0}
                  y1={y}
                  x2={SVG_WIDTH}
                  y2={y}
                  stroke={lat === 0 ? '#1e3a5f' : '#0f2238'}
                  strokeWidth={lat === 0 ? 1.5 : 1}
                />
              );
            })}
            {[-120, -60, 0, 60, 120].map((lon) => {
              const { x } = latLonToSvg(0, lon);
              return (
                <Line
                  key={`lon-${lon}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={SVG_HEIGHT}
                  stroke={lon === 0 ? '#1e3a5f' : '#0f2238'}
                  strokeWidth={lon === 0 ? 1.5 : 1}
                />
              );
            })}

            {/* Continentes */}
            <G>
              {CONTINENT_PATHS.map((d, i) => (
                <Path
                  key={`cont-${i}`}
                  d={d}
                  fill="#132840"
                  stroke="#234567"
                  strokeWidth={1.2}
                />
              ))}
            </G>

            {/* Footprint del satélite seleccionado (RF-12) */}
            {footprint &&
              footprint.polygonSegments.map((seg, idx) => (
                <SvgPolyline
                  key={`svg-fp-${idx}`}
                  points={pointsToSvgString(seg)}
                  fill="rgba(34, 197, 94, 0.16)"
                  stroke="#22c55e"
                  strokeWidth={1.8}
                />
              ))}

            {/* Ground Track dividido en el antimeridiano ±180° (RF-11) */}
            {groundTrack.map((seg) => (
              <SvgPolyline
                key={seg.id}
                points={pointsToSvgString(seg.points)}
                fill="none"
                stroke={seg.isPast ? '#64748b' : '#38bdf8'}
                strokeWidth={seg.isPast ? 1.8 : 2.6}
                strokeDasharray={seg.isPast ? '5,4' : undefined}
              />
            ))}

            {/* Capa de constelación multi-satélite (Starlink) (RF-13) */}
            {showConstellation &&
              constellationStates.map((st) => {
                const pt = latLonToSvg(st.latitude, st.longitude);
                return (
                  <G key={`svg-const-${st.noradId}`}>
                    <SvgCircle
                      cx={pt.x}
                      cy={pt.y}
                      r={3.5}
                      fill={st.isVisible ? '#facc15' : '#f59e0b'}
                      stroke="#0f172a"
                      strokeWidth={0.8}
                    />
                  </G>
                );
              })}

            {/* Ubicación del Observador (Estación Terrena) */}
            <G>
              <SvgCircle
                cx={obsSvg.x}
                cy={obsSvg.y}
                r={5}
                fill="#10b981"
                stroke="#ffffff"
                strokeWidth={1.5}
              />
              <SvgText
                x={obsSvg.x + 8}
                y={obsSvg.y + 4}
                fill="#6ee7b7"
                fontSize="10"
                fontWeight="bold"
              >
                OBS
              </SvgText>
            </G>

            {/* Posición en tiempo real del Satélite Seleccionado (RF-10) */}
            {satSvg && selectedSatellite && (
              <G>
                <SvgCircle
                  cx={satSvg.x}
                  cy={satSvg.y}
                  r={11}
                  fill="rgba(239, 68, 68, 0.28)"
                />
                <SvgCircle
                  cx={satSvg.x}
                  cy={satSvg.y}
                  r={5.5}
                  fill="#ef4444"
                  stroke="#ffffff"
                  strokeWidth={1.8}
                />
                <SvgText
                  x={Math.min(SVG_WIDTH - 95, satSvg.x + 9)}
                  y={Math.max(14, satSvg.y - 6)}
                  fill="#f8fafc"
                  fontSize="11"
                  fontWeight="bold"
                >
                  {selectedSatellite.name}
                </SvgText>
              </G>
            )}
          </Svg>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0b1526',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  mapHeaderBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    flexWrap: 'wrap',
    gap: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: '#cbd5e1',
    fontSize: 11,
    marginRight: 6,
  },
  modeToggleBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modeToggleText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '600',
  },
  nativeMap: {
    width: '100%',
    height: 255,
  },
  svgMapWrapper: {
    width: '100%',
    aspectRatio: 2,
    backgroundColor: '#07111e',
  },
  svgCanvas: {
    width: '100%',
    height: '100%',
  },
});

