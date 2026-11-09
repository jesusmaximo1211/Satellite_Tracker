/**
 * Gráfico Polar de Trayectoria de Pase (Sky Chart Polar en SVG - RF-05 y Sección 4.6):
 * - Representa el hemisferio celeste del observador con círculos concéntricos de elevación (0°, 30°, 60°, 90°).
 * - Dibuja el anillo del umbral de elevación mínima configurable (ε_min).
 * - Traza la trayectoria completa del pase desde AOS -> Punto de Máxima Elevación (MAX) -> LOS.
 * - Muestra en vivo la posición polar actual del satélite si se encuentra sobre el horizonte.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Text as SvgText,
} from 'react-native-svg';
import { PassWindow, SatelliteRealtimeState } from '../types/orbital';

export interface SkyChartPolarProps {
  pass: PassWindow | null;
  realtimeState: SatelliteRealtimeState | null;
  minElevationDeg: number;
}

const SIZE = 280;
const CENTER = SIZE / 2;
const MAX_RADIUS = 108;

/**
 * Convierte coordenadas polares topocéntricas (Azimut [0..360°], Elevación [0..90°])
 * a coordenadas cartesianas (x, y) dentro del SVG polar.
 * 0° Azimut = Norte (Arriba), 90° = Este (Derecha), 180° = Sur (Abajo), 270° = Oeste (Izquierda).
 */
export function polarToCartesian(azimuthDeg: number, elevationDeg: number): { x: number; y: number } {
  const clampedEl = Math.max(0, Math.min(90, elevationDeg));
  const r = MAX_RADIUS * (1 - clampedEl / 90);
  const thetaRad = ((azimuthDeg - 90) * Math.PI) / 180;
  return {
    x: CENTER + r * Math.cos(thetaRad),
    y: CENTER + r * Math.sin(thetaRad),
  };
}

export const SkyChartPolar: React.FC<SkyChartPolarProps> = ({
  pass,
  realtimeState,
  minElevationDeg,
}) => {
  const thresholdRadius = MAX_RADIUS * (1 - Math.max(0, Math.min(90, minElevationDeg)) / 90);

  // Construcción del path SVG para la curva de trayectoria del pase
  let trajectoryPath = '';
  if (pass && pass.trajectory.length > 0) {
    trajectoryPath = pass.trajectory
      .map((pt, idx) => {
        const { x, y } = polarToCartesian(pt.azimuthDeg, pt.elevationDeg);
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }

  const aosPoint = pass ? polarToCartesian(pass.aosAzimuthDeg, pass.minElevationThresholdDeg) : null;
  const maxPoint = pass ? polarToCartesian(pass.maxAzimuthDeg, pass.maxElevationDeg) : null;
  const losPoint = pass ? polarToCartesian(pass.losAzimuthDeg, pass.minElevationThresholdDeg) : null;

  const livePoint =
    realtimeState && realtimeState.elevationDeg >= 0
      ? polarToCartesian(realtimeState.azimuthDeg, realtimeState.elevationDeg)
      : null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Sky Chart Polar (SVG)</Text>
        <Text style={styles.subtitle}>
          {pass
            ? `Pase: ${new Date(pass.aosTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Máx ${pass.maxElevationDeg.toFixed(1)}°`
            : 'Sin pase seleccionado'}
        </Text>
      </View>

      <View style={styles.svgWrapper}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {/* Fondo del domo celeste */}
          <Circle cx={CENTER} cy={CENTER} r={MAX_RADIUS + 4} fill="#07111e" />

          {/* Anillos concéntricos de elevación: 0° (horizonte), 30°, 60° */}
          {[0, 30, 60].map((el) => {
            const r = MAX_RADIUS * (1 - el / 90);
            return (
              <G key={`ring-${el}`}>
                <Circle
                  cx={CENTER}
                  cy={CENTER}
                  r={r}
                  fill="none"
                  stroke={el === 0 ? '#334155' : '#1e293b'}
                  strokeWidth={el === 0 ? 1.8 : 1}
                />
                <SvgText
                  x={CENTER + 4}
                  y={CENTER - r + 11}
                  fill="#64748b"
                  fontSize="9"
                >
                  {`${el}°`}
                </SvgText>
              </G>
            );
          })}

          {/* Anillo de elevación mínima configurable (ε_min) */}
          <Circle
            cx={CENTER}
            cy={CENTER}
            r={thresholdRadius}
            fill="rgba(34, 197, 94, 0.05)"
            stroke="#22c55e"
            strokeWidth={1.2}
            strokeDasharray="4,4"
          />

          {/* Ejes cardinales N-S y E-O + diagonales */}
          <Line
            x1={CENTER}
            y1={CENTER - MAX_RADIUS}
            x2={CENTER}
            y2={CENTER + MAX_RADIUS}
            stroke="#1e293b"
            strokeWidth={1}
          />
          <Line
            x1={CENTER - MAX_RADIUS}
            y1={CENTER}
            x2={CENTER + MAX_RADIUS}
            y2={CENTER}
            stroke="#1e293b"
            strokeWidth={1}
          />

          {/* Etiquetas de puntos cardinales */}
          <SvgText x={CENTER - 4} y={CENTER - MAX_RADIUS - 8} fill="#38bdf8" fontSize="12" fontWeight="bold">
            N
          </SvgText>
          <SvgText x={CENTER + MAX_RADIUS + 8} y={CENTER + 4} fill="#94a3b8" fontSize="11" fontWeight="bold">
            E
          </SvgText>
          <SvgText x={CENTER - 4} y={CENTER + MAX_RADIUS + 16} fill="#94a3b8" fontSize="11" fontWeight="bold">
            S
          </SvgText>
          <SvgText x={CENTER - MAX_RADIUS - 18} y={CENTER + 4} fill="#94a3b8" fontSize="11" fontWeight="bold">
            O
          </SvgText>

          {/* Curva polar del pase (AOS -> MAX -> LOS) */}
          {trajectoryPath ? (
            <Path
              d={trajectoryPath}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={2.8}
            />
          ) : null}

          {/* Punto AOS (Inicio de señal) */}
          {aosPoint && (
            <G>
              <Circle cx={aosPoint.x} cy={aosPoint.y} r={5} fill="#22c55e" stroke="#0f172a" strokeWidth={1.5} />
              <SvgText x={aosPoint.x + 7} y={aosPoint.y + 3} fill="#4ade80" fontSize="9" fontWeight="bold">
                AOS
              </SvgText>
            </G>
          )}

          {/* Punto MAX (Elevación máxima) */}
          {maxPoint && (
            <G>
              <Circle cx={maxPoint.x} cy={maxPoint.y} r={5.5} fill="#facc15" stroke="#0f172a" strokeWidth={1.5} />
              <SvgText x={maxPoint.x + 7} y={maxPoint.y - 4} fill="#fde047" fontSize="9" fontWeight="bold">
                MAX
              </SvgText>
            </G>
          )}

          {/* Punto LOS (Pérdida de señal) */}
          {losPoint && (
            <G>
              <Circle cx={losPoint.x} cy={losPoint.y} r={5} fill="#f97316" stroke="#0f172a" strokeWidth={1.5} />
              <SvgText x={losPoint.x + 7} y={losPoint.y + 3} fill="#fb923c" fontSize="9" fontWeight="bold">
                LOS
              </SvgText>
            </G>
          )}

          {/* Posición actual en vivo si el satélite está sobre el horizonte (el >= 0°) */}
          {livePoint && (
            <G>
              <Circle cx={livePoint.x} cy={livePoint.y} r={9} fill="rgba(239, 68, 68, 0.25)" />
              <Circle cx={livePoint.x} cy={livePoint.y} r={4.5} fill="#ef4444" stroke="#ffffff" strokeWidth={1.5} />
            </G>
          )}
        </Svg>
      </View>

      <View style={styles.legendFooter}>
        <Text style={styles.footerItem}>🟢 AOS (Inicio)</Text>
        <Text style={styles.footerItem}>🟡 MAX (Culminación)</Text>
        <Text style={styles.footerItem}>🟠 LOS (Fin)</Text>
        <Text style={styles.footerItem}>🔴 Satélite Ahora</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    alignItems: 'center',
  },
  headerRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },
  svgWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 6,
  },
  footerItem: {
    color: '#94a3b8',
    fontSize: 11,
  },
});

